from __future__ import annotations

import json
from pathlib import Path
import shutil
from typing import Any

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.models import new_ulid


settings = get_settings()


def ensure_storage_dirs() -> None:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    settings.export_root.mkdir(parents=True, exist_ok=True)


def save_upload(upload: UploadFile, user_id: str, subdir: str = "meal-photos") -> Path:
    target_dir = settings.upload_root / user_id / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "upload.bin").suffix or ".bin"
    target_path = target_dir / f"{new_ulid()}{suffix}"
    with target_path.open("wb") as handle:
        shutil.copyfileobj(upload.file, handle)
    return target_path


def write_json_export(name: str, payload: dict[str, Any], user_id: str) -> Path:
    target_dir = settings.export_root / user_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{name}-{new_ulid()}.json"
    target_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return target_path
