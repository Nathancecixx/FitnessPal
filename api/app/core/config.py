from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path


_DEFAULT_ALLOW_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
_DEFAULT_ALLOWED_AI_HOSTS = (
    "api.openai.com",
    "api.anthropic.com",
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
)


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    api_prefix: str
    database_url: str
    sql_echo: bool
    config_secret: str | None
    admin_username: str
    admin_password: str
    session_days: int
    password_setup_hours: int
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
    allow_insecure_http_private_hosts: bool
    allowed_ai_hosts: tuple[str, ...]
    max_upload_bytes: int
    login_rate_limit_attempts: int
    login_rate_limit_window_seconds: int
    enforce_secure_bootstrap: bool


def _split_csv(value: str | None, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    if not value:
        return default
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
        config_secret=os.getenv("FITNESSPAL_CONFIG_SECRET"),
        admin_username=os.getenv("FITNESSPAL_ADMIN_USERNAME", os.getenv("FITNESSPAL_BOOTSTRAP_USERNAME", "owner")),
        admin_password=os.getenv("FITNESSPAL_ADMIN_PASSWORD", os.getenv("FITNESSPAL_BOOTSTRAP_PASSWORD", "fitnesspal")),
        session_days=int(os.getenv("FITNESSPAL_SESSION_DAYS", "30")),
        password_setup_hours=int(os.getenv("FITNESSPAL_PASSWORD_SETUP_HOURS", "72")),
        storage_root=storage_root,
        upload_root=upload_root,
        export_root=export_root,
        local_ai_base_url=os.getenv("FITNESSPAL_LOCAL_AI_BASE_URL"),
        local_ai_model=os.getenv("FITNESSPAL_LOCAL_AI_MODEL", "qwen3-vl:8b"),
        local_ai_timeout_seconds=int(os.getenv("FITNESSPAL_LOCAL_AI_TIMEOUT_SECONDS", "60")),
        barcode_lookup_base_url=os.getenv("FITNESSPAL_BARCODE_LOOKUP_BASE_URL", "https://world.openfoodfacts.org"),
        barcode_lookup_timeout_seconds=int(os.getenv("FITNESSPAL_BARCODE_LOOKUP_TIMEOUT_SECONDS", "10")),
        barcode_lookup_user_agent=os.getenv("FITNESSPAL_BARCODE_LOOKUP_USER_AGENT", "FitnessPal/0.1.0"),
        allow_origins=_split_csv(os.getenv("FITNESSPAL_ALLOW_ORIGINS"), _DEFAULT_ALLOW_ORIGINS),
        allow_insecure_http_private_hosts=(
            os.getenv("FITNESSPAL_ALLOW_INSECURE_HTTP_PRIVATE_HOSTS", "false").lower() == "true"
        ),
        allowed_ai_hosts=_split_csv(os.getenv("FITNESSPAL_ALLOWED_AI_HOSTS"), _DEFAULT_ALLOWED_AI_HOSTS),
        max_upload_bytes=int(os.getenv("FITNESSPAL_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
        login_rate_limit_attempts=int(os.getenv("FITNESSPAL_LOGIN_RATE_LIMIT_ATTEMPTS", "10")),
        login_rate_limit_window_seconds=int(os.getenv("FITNESSPAL_LOGIN_RATE_LIMIT_WINDOW_SECONDS", "900")),
        enforce_secure_bootstrap=os.getenv("FITNESSPAL_ENFORCE_SECURE_BOOTSTRAP", "true").lower() == "true",
    )


def ensure_secure_runtime_settings() -> None:
    settings = get_settings()
    if not settings.enforce_secure_bootstrap:
        return

    normalized_password = settings.admin_password.strip().lower()
    if normalized_password in {"fitnesspal", "password", "changeme", "change-me", "admin", "owner"}:
        raise RuntimeError(
            "FITNESSPAL_ADMIN_PASSWORD is using a known insecure default. Set a unique bootstrap password before startup."
        )
    if len(settings.admin_password) < 12:
        raise RuntimeError("FITNESSPAL_ADMIN_PASSWORD must be at least 12 characters long.")
