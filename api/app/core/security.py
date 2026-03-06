from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session
from app.core.models import ApiKey, AppUser, PasswordSetupToken, SessionToken, utcnow


settings = get_settings()
SESSION_SCOPES = (
    "platform:read",
    "platform:write",
    "nutrition:*",
    "training:*",
    "metrics:*",
    "insights:*",
    "assistant:use",
)


@dataclass(slots=True)
class Actor:
    actor_type: str
    actor_id: str
    display_name: str
    scopes: tuple[str, ...]
    user_id: str
    username: str
    is_admin: bool


def hash_password(password: str, salt: bytes | None = None) -> str:
    active_salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=active_salt, n=2**14, r=8, p=1)
    return f"{active_salt.hex()}:{digest.hex()}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded or ":" not in encoded:
        return False
    salt_hex, digest_hex = encoded.split(":", 1)
    comparison = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(comparison.hex(), digest_hex)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def ensure_admin_user(session: Session) -> AppUser:
    user = session.scalar(select(AppUser).where(AppUser.username == settings.admin_username))
    if not user:
        user = AppUser(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            is_active=True,
            is_admin=True,
            password_set_at=utcnow(),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    changed = False
    if not user.is_admin:
        user.is_admin = True
        changed = True
    if not user.password_hash:
        user.password_hash = hash_password(settings.admin_password)
        user.password_set_at = utcnow()
        changed = True
    if changed:
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


def create_password_setup_token(
    session: Session,
    user: AppUser,
    *,
    created_by_user_id: str | None = None,
) -> tuple[PasswordSetupToken, str]:
    for existing in session.scalars(
        select(PasswordSetupToken).where(
            PasswordSetupToken.user_id == user.id,
            PasswordSetupToken.used_at.is_(None),
            PasswordSetupToken.expires_at >= utcnow(),
        )
    ).all():
        existing.used_at = utcnow()

    token = f"fpset_{secrets.token_urlsafe(36)}"
    record = PasswordSetupToken(
        user_id=user.id,
        created_by_user_id=created_by_user_id,
        token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(hours=settings.password_setup_hours),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record, token


def redeem_password_setup_token(session: Session, token: str, new_password: str) -> AppUser:
    record = session.scalar(
        select(PasswordSetupToken).where(
            PasswordSetupToken.token_hash == hash_token(token),
            PasswordSetupToken.used_at.is_(None),
        )
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Password setup token not found.")
    if as_utc(record.expires_at) < utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Password setup token has expired.")

    user = session.scalar(select(AppUser).where(AppUser.id == record.user_id, AppUser.is_active.is_(True)))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.password_hash = hash_password(new_password)
    user.password_set_at = utcnow()
    record.used_at = utcnow()
    session.commit()
    session.refresh(user)
    return user


def change_password(session: Session, user: AppUser, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")
    user.password_hash = hash_password(new_password)
    user.password_set_at = utcnow()
    session.commit()


def _build_actor(
    *,
    actor_type: str,
    actor_id: str,
    display_name: str,
    scopes: tuple[str, ...],
    user: AppUser,
) -> Actor:
    return Actor(
        actor_type=actor_type,
        actor_id=actor_id,
        display_name=display_name,
        scopes=scopes,
        user_id=user.id,
        username=user.username,
        is_admin=user.is_admin,
    )


def _resolve_api_key(session: Session, token: str) -> Actor | None:
    hashed = hash_token(token)
    api_key = session.scalar(select(ApiKey).where(ApiKey.token_hash == hashed, ApiKey.revoked_at.is_(None)))
    if not api_key:
        return None
    if api_key.expires_at and as_utc(api_key.expires_at) < utcnow():
        return None
    user = session.scalar(select(AppUser).where(AppUser.id == api_key.user_id, AppUser.is_active.is_(True)))
    if not user:
        return None
    api_key.last_used_at = utcnow()
    session.commit()
    return _build_actor(
        actor_type="api_key",
        actor_id=api_key.id,
        display_name=api_key.name,
        scopes=tuple(api_key.scopes or ["*"]),
        user=user,
    )


def _resolve_session(session: Session, token: str) -> Actor | None:
    record = session.scalar(
        select(SessionToken).where(SessionToken.token_hash == hash_token(token), SessionToken.revoked_at.is_(None))
    )
    if not record:
        return None
    if as_utc(record.expires_at) < utcnow():
        return None
    user = session.scalar(select(AppUser).where(AppUser.id == record.user_id, AppUser.is_active.is_(True)))
    if not user:
        return None
    record.last_used_at = utcnow()
    session.commit()
    scopes = SESSION_SCOPES + (("admin:*",) if user.is_admin else ())
    return _build_actor(
        actor_type="session",
        actor_id=record.id,
        display_name=user.username,
        scopes=scopes,
        user=user,
    )


def resolve_actor_from_credentials(
    session: Session,
    *,
    authorization: str | None = None,
    session_cookie: str | None = None,
) -> Actor | None:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        actor = _resolve_api_key(session, token)
        if actor:
            return actor
        actor = _resolve_session(session, token)
        if actor:
            return actor

    if session_cookie:
        actor = _resolve_session(session, session_cookie)
        if actor:
            return actor

    return None


def get_actor(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias="fitnesspal_session"),
    session: Session = Depends(get_session),
) -> Actor:
    actor = resolve_actor_from_credentials(session, authorization=authorization, session_cookie=session_cookie)
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
    def scope_matches(granted_scope: str, required_scope: str) -> bool:
        if granted_scope == "*" or granted_scope == required_scope:
            return True
        if granted_scope.endswith(":*"):
            prefix = granted_scope[:-2]
            return required_scope == prefix or required_scope.startswith(f"{prefix}:")
        return False

    def dependency(actor: Actor = Depends(get_actor)) -> Actor:
        if "*" in actor.scopes:
            return actor
        missing = [
            scope
            for scope in required_scopes
            if not any(scope_matches(granted_scope, scope) for granted_scope in actor.scopes)
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required scopes: {', '.join(missing)}",
            )
        return actor

    return dependency


def require_admin(actor: Actor = Depends(get_actor)) -> Actor:
    if not actor.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return actor
