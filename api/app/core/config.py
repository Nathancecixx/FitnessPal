from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    api_prefix: str
    database_url: str
    sql_echo: bool
    bootstrap_username: str
    bootstrap_password: str
    session_days: int
    storage_root: Path
    upload_root: Path
    export_root: Path
    local_ai_base_url: str | None
    local_ai_model: str
    local_ai_timeout_seconds: int
    barcode_lookup_base_url: str
    barcode_lookup_timeout_seconds: int
    barcode_lookup_user_agent: str
    allow_origins: tuple[str, ...]
    agent_manifest_url: str


def _split_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ("http://localhost:5173", "http://127.0.0.1:5173")
    return tuple(part.strip() for part in value.split(",") if part.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    storage_root = Path(os.getenv("FITNESSPAL_STORAGE_ROOT", "storage")).resolve()
    upload_root = storage_root / "uploads"
    export_root = storage_root / "exports"
    return Settings(
        app_name=os.getenv("FITNESSPAL_APP_NAME", "FitnessPal"),
        api_prefix=os.getenv("FITNESSPAL_API_PREFIX", "/api/v1"),
        database_url=os.getenv(
            "FITNESSPAL_DATABASE_URL",
            "postgresql+psycopg://fitnesspal:fitnesspal@postgres:5432/fitnesspal",
        ),
        sql_echo=os.getenv("FITNESSPAL_SQL_ECHO", "false").lower() == "true",
        bootstrap_username=os.getenv("FITNESSPAL_BOOTSTRAP_USERNAME", "owner"),
        bootstrap_password=os.getenv("FITNESSPAL_BOOTSTRAP_PASSWORD", "fitnesspal"),
        session_days=int(os.getenv("FITNESSPAL_SESSION_DAYS", "30")),
        storage_root=storage_root,
        upload_root=upload_root,
        export_root=export_root,
        local_ai_base_url=os.getenv("FITNESSPAL_LOCAL_AI_BASE_URL"),
        local_ai_model=os.getenv("FITNESSPAL_LOCAL_AI_MODEL", "qwen3-vl:8b"),
        local_ai_timeout_seconds=int(os.getenv("FITNESSPAL_LOCAL_AI_TIMEOUT_SECONDS", "60")),
        barcode_lookup_base_url=os.getenv("FITNESSPAL_BARCODE_LOOKUP_BASE_URL", "https://world.openfoodfacts.org"),
        barcode_lookup_timeout_seconds=int(os.getenv("FITNESSPAL_BARCODE_LOOKUP_TIMEOUT_SECONDS", "10")),
        barcode_lookup_user_agent=os.getenv("FITNESSPAL_BARCODE_LOOKUP_USER_AGENT", "FitnessPal/0.1.0"),
        allow_origins=_split_csv(os.getenv("FITNESSPAL_ALLOW_ORIGINS")),
        agent_manifest_url=os.getenv(
            "FITNESSPAL_AGENT_MANIFEST_URL",
            "http://localhost:8080/.well-known/fitnesspal-agent.json",
        ),
    )
