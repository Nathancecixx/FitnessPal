from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.models import new_ulid


settings = get_settings()
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def ensure_storage_dirs() -> None:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    settings.export_root.mkdir(parents=True, exist_ok=True)


def ensure_managed_upload_path(path: Path, *, user_id: str | None = None) -> Path:
    resolved_path = path.expanduser().resolve(strict=False)
    base_path = (settings.upload_root / user_id).resolve(strict=False) if user_id else settings.upload_root.resolve(strict=False)
    try:
        resolved_path.relative_to(base_path)
    except ValueError as error:
        raise RuntimeError("Upload path is outside managed storage.") from error
    return resolved_path


def _sniff_image_suffix(prefix: bytes) -> str | None:
    if prefix.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP":
        return ".webp"
    return None


def save_upload(upload: UploadFile, user_id: str, subdir: str = "meal-photos") -> Path:
    if Path(subdir).name != subdir:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload target.")

    content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    suffix = ALLOWED_IMAGE_CONTENT_TYPES.get(content_type)
    if not suffix:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, and WEBP images are supported.",
        )

    target_dir = settings.upload_root / user_id / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{new_ulid()}{suffix}"
    bytes_written = 0
    sniffed_suffix: str | None = None
    try:
        with target_path.open("wb") as handle:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                if sniffed_suffix is None:
                    sniffed_suffix = _sniff_image_suffix(chunk[:16])
                    if sniffed_suffix != suffix:
                        raise HTTPException(
                            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            detail="Uploaded file contents do not match the declared image type.",
                        )
                bytes_written += len(chunk)
                if bytes_written > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Uploads must be {settings.max_upload_bytes // (1024 * 1024)} MB or smaller.",
                    )
                handle.write(chunk)
        if bytes_written == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file was empty.")
    except Exception:
        target_path.unlink(missing_ok=True)
        raise
    return target_path


def write_json_export(name: str, payload: dict[str, Any], user_id: str) -> Path:
    target_dir = settings.export_root / user_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{name}-{new_ulid()}.json"
    target_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return target_path
