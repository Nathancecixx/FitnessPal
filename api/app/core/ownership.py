from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session


OwnedModelT = TypeVar("OwnedModelT")


def ensure_owned(
    session: Session,
    model: type[OwnedModelT],
    record_id: str,
    user_id: str,
    detail: str,
    *,
    include_deleted: bool = False,
) -> OwnedModelT:
    row = session.get(model, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    if getattr(row, "user_id", None) != user_id:
        raise HTTPException(status_code=404, detail=detail)
    if not include_deleted and hasattr(row, "deleted_at") and getattr(row, "deleted_at") is not None:
        raise HTTPException(status_code=404, detail=detail)
    return row


def attach_owner(values: dict[str, Any], user_id: str) -> dict[str, Any]:
    return {**values, "user_id": user_id}
