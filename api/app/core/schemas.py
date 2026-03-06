from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field


class MacroTotals(BaseModel):
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    sodium_mg: float = 0


class DashboardCardDefinition(BaseModel):
    key: str
    title: str
    route: str
    description: str
    accent: str = "slate"
    priority: int = 0


class DashboardCardState(DashboardCardDefinition):
    value: str | float | None = None
    detail: str | None = None
    trend: float | None = None
    status: str = "neutral"


class AgentExample(BaseModel):
    key: str
    title: str
    method: str
    path: str
    summary: str
    request_body: dict[str, Any] | None = None


class DomainEvent(BaseModel):
    key: str
    emitted_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentManifest(BaseModel):
    name: str
    version: str
    base_url: str
    auth: dict[str, Any]
    capabilities: list[str]
    resources: list[dict[str, Any]]
    examples: list[AgentExample]


T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
