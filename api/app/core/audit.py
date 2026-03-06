from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.models import AuditLog
from app.core.security import Actor


def write_audit(
    session: Session,
    actor: Actor | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    payload: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=actor.user_id if actor else None,
            actor_type=actor.actor_type if actor else "system",
            actor_id=actor.actor_id if actor else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload_json=payload or {},
        )
    )
    session.commit()
