from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import hashlib
import hmac
import secrets

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session
from app.core.models import ApiKey, AppUser, SessionToken, utcnow


settings = get_settings()


@dataclass(slots=True)
class Actor:
    actor_type: str
    actor_id: str
    display_name: str
    scopes: tuple[str, ...]
    user_id: str


def hash_password(password: str, salt: bytes | None = None) -> str:
    active_salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=active_salt, n=2**14, r=8, p=1)
    return f"{active_salt.hex()}:{digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    salt_hex, digest_hex = encoded.split(":", 1)
    comparison = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(comparison.hex(), digest_hex)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ensure_bootstrap_user(session: Session) -> AppUser:
    user = session.scalar(select(AppUser).limit(1))
    if user:
        return user
    user = AppUser(
        username=settings.bootstrap_username,
        password_hash=hash_password(settings.bootstrap_password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def authenticate_user(session: Session, username: str, password: str) -> AppUser | None:
    user = session.scalar(select(AppUser).where(AppUser.username == username, AppUser.is_active.is_(True)))
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_session_token(session: Session, user: AppUser) -> str:
    raw_token = secrets.token_urlsafe(48)
    record = SessionToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=utcnow() + timedelta(days=settings.session_days),
    )
    session.add(record)
    session.commit()
    return raw_token


def create_api_key(session: Session, user: AppUser, name: str, scopes: list[str]) -> tuple[ApiKey, str]:
    token = f"fp_{secrets.token_urlsafe(36)}"
    record = ApiKey(
        user_id=user.id,
        name=name,
        prefix=token[:12],
        token_hash=hash_token(token),
        scopes=scopes or ["*"],
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record, token


def _resolve_api_key(session: Session, token: str) -> Actor | None:
    hashed = hash_token(token)
    api_key = session.scalar(select(ApiKey).where(ApiKey.token_hash == hashed, ApiKey.revoked_at.is_(None)))
    if not api_key:
        return None
    if api_key.expires_at and api_key.expires_at < utcnow():
        return None
    user = session.scalar(select(AppUser).where(AppUser.id == api_key.user_id))
    if not user:
        return None
    api_key.last_used_at = utcnow()
    session.commit()
    return Actor(
        actor_type="api_key",
        actor_id=api_key.id,
        display_name=api_key.name,
        scopes=tuple(api_key.scopes or ["*"]),
        user_id=user.id,
    )


def _resolve_session(session: Session, token: str) -> Actor | None:
    record = session.scalar(
        select(SessionToken).where(SessionToken.token_hash == hash_token(token), SessionToken.revoked_at.is_(None))
    )
    if not record:
        return None
    if record.expires_at < utcnow():
        return None
    user = session.scalar(select(AppUser).where(AppUser.id == record.user_id, AppUser.is_active.is_(True)))
    if not user:
        return None
    record.last_used_at = utcnow()
    session.commit()
    return Actor(
        actor_type="session",
        actor_id=record.id,
        display_name=user.username,
        scopes=("*",),
        user_id=user.id,
    )


def get_actor(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias="fitnesspal_session"),
    session: Session = Depends(get_session),
) -> Actor:
    if authorization and authorization.lower().startswith("bearer "):
        actor = _resolve_api_key(session, authorization.split(" ", 1)[1].strip())
        if actor:
            return actor

    if session_cookie:
        actor = _resolve_session(session, session_cookie)
        if actor:
            return actor

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")


def get_optional_actor(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias="fitnesspal_session"),
    session: Session = Depends(get_session),
) -> Actor | None:
    try:
        return get_actor(authorization, session_cookie, session)
    except HTTPException:
        return None


def require_scope(*required_scopes: str):
    def dependency(actor: Actor = Depends(get_actor)) -> Actor:
        if "*" in actor.scopes:
            return actor
        missing = [scope for scope in required_scopes if scope not in actor.scopes]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required scopes: {', '.join(missing)}",
            )
        return actor

    return dependency
