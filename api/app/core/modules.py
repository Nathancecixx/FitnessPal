from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.core.schemas import DashboardCardDefinition, DashboardCardState
from app.core.security import Actor


DashboardLoader = Callable[[Session, Actor], Sequence[DashboardCardState]]
JobHandler = Callable[[Session, dict[str, Any]], dict[str, Any] | None]


@dataclass(slots=True)
class ModuleManifest:
    key: str
    router: APIRouter
    dashboard_cards: list[DashboardCardDefinition] = field(default_factory=list)
    dashboard_loader: DashboardLoader | None = None
    job_handlers: dict[str, JobHandler] = field(default_factory=dict)
