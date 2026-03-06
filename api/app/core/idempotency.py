from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.models import IdempotencyRecord


WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class IdempotentRoute(APIRoute):
    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def custom_handler(request):
            if request.method.upper() not in WRITE_METHODS:
                return await original_handler(request)

            key = request.headers.get("Idempotency-Key")
            if not key:
                return await original_handler(request)

            body = await request.body()
            body_hash = hashlib.sha256(body).hexdigest()

            with SessionLocal() as session:
                existing = session.scalar(
                    select(IdempotencyRecord).where(
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
