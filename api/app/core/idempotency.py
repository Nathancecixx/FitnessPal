from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.models import IdempotencyRecord
from app.core.security import resolve_actor_from_credentials


WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
NON_REPLAYABLE_PATH_SUFFIXES = (
    "/auth/login",
    "/auth/password/setup",
    "/api-keys",
    "/users",
)


def _normalize_idempotency_path(path: str) -> str:
    api_prefix = get_settings().api_prefix.rstrip("/")
    if api_prefix and path.startswith(api_prefix):
        trimmed = path[len(api_prefix) :]
        return trimmed or "/"
    return path


class IdempotentRoute(APIRoute):
    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def custom_handler(request):
            if request.method.upper() not in WRITE_METHODS:
                return await original_handler(request)

            key = request.headers.get("Idempotency-Key")
            if not key:
                return await original_handler(request)
            normalized_path = _normalize_idempotency_path(request.url.path)
            if any(normalized_path == suffix or normalized_path.startswith(f"{suffix}/") for suffix in NON_REPLAYABLE_PATH_SUFFIXES):
                raise HTTPException(
                    status_code=400,
                    detail="Idempotency-Key is not supported for routes that return one-time credentials or tokens.",
                )

            body = await request.body()
            body_hash = hashlib.sha256(body).hexdigest()
            actor = None

            with SessionLocal() as session:
                actor = resolve_actor_from_credentials(
                    session,
                    authorization=request.headers.get("Authorization"),
                    session_cookie=request.cookies.get("fitnesspal_session"),
                )
                user_filter = (
                    IdempotencyRecord.user_id == actor.user_id if actor else IdempotencyRecord.user_id.is_(None)
                )
                existing = session.scalar(
                    select(IdempotencyRecord).where(
                        user_filter,
                        IdempotencyRecord.key == key,
                        IdempotencyRecord.method == request.method.upper(),
                        IdempotencyRecord.path == request.url.path,
                    )
                )
                if existing:
                    if existing.body_hash != body_hash:
                        raise HTTPException(status_code=409, detail="Idempotency key already used with different input.")
                    return JSONResponse(
                        status_code=existing.status_code,
                        content=existing.response_json,
                        headers={"X-Idempotent-Replay": "true"},
                    )

            response = await original_handler(request)
            content_type = response.headers.get("content-type", "")
            if 200 <= response.status_code < 400 and content_type.startswith("application/json"):
                try:
                    parsed_body = json.loads(response.body.decode("utf-8"))
                except (AttributeError, json.JSONDecodeError):
                    return response

                with SessionLocal() as session:
                    session.add(
                        IdempotencyRecord(
                            user_id=actor.user_id if actor else None,
                            key=key,
                            method=request.method.upper(),
                            path=request.url.path,
                            body_hash=body_hash,
                            status_code=response.status_code,
                            response_json=parsed_body,
                        )
                    )
                    session.commit()

            return response

        return custom_handler
