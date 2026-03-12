from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass
from ipaddress import ip_address, ip_network
from pathlib import Path
import json
import re
from typing import Any
from urllib.parse import SplitResult, urlsplit, urlunsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.config_crypto import decrypt_secret_payload, encrypt_secret_payload
from app.core.models import AiFeatureBinding, AiPersonaConfig, AiProfile, CoachBrief, Goal, InsightSnapshot, MealEntry, WeightEntry, WorkoutSession, utcnow
from app.core.storage import ensure_managed_upload_path


settings = get_settings()
SUPPORTED_AI_PROVIDERS = ("openai", "anthropic", "ollama")
AI_FEATURE_KEYS = (
    "meal_photo_estimation",
    "nutrition_label_scan",
    "assistant_quick_capture",
    "coach_brief",
)
DEFAULT_FEATURE_SETTINGS: dict[str, dict[str, Any]] = {
    "meal_photo_estimation": {"temperature": 0.2},
    "nutrition_label_scan": {"temperature": 0.1},
    "assistant_quick_capture": {"temperature": 0.15},
    "coach_brief": {"temperature": 0.65, "max_output_tokens": 700},
}
DEFAULT_PERSONA = {
    "display_name": "FitnessPal Coach",
    "tagline": "The local-first fitness coach that talks like your brand, not a spreadsheet.",
    "system_prompt": (
        "You are FitnessPal Coach, the in-app voice of an open source, local-first AI fitness coach. "
        "Be concise, concrete, and brandable. Sound direct, smart, and slightly gimmicky in a good way. "
        "Never claim certainty you do not have, never invent logged data, and never suggest that you already changed user data."
    ),
    "voice_guidelines_json": {
        "brand_pillars": ["local-first", "coach-like", "practical", "brandable"],
        "style": "short, direct, high-signal",
    },
}
_LEGACY_PROFILE_ID = "legacy-local-ai"
_MASKED_HEADER_VALUE = "[redacted]"


class AiConfigurationError(RuntimeError):
    pass


class AiProfileReadOnlyError(RuntimeError):
    pass


@dataclass(slots=True)
class ResolvedAiProfile:
    id: str
    name: str
    provider: str
    base_url: str
    api_key: str | None
    default_model: str | None
    timeout_seconds: int
    is_enabled: bool
    is_read_only: bool
    default_headers: dict[str, str]
    advanced_settings: dict[str, Any]
    models: list[str]
    last_reachable: bool
    last_tested_at: Any
    last_error: str | None
    source: str
    description: str | None = None


@dataclass(slots=True)
class ResolvedAiFeature:
    feature_key: str
    profile: ResolvedAiProfile | None
    model: str | None
    request_settings: dict[str, Any]
    system_prompt: str | None
    source: str


def _normalize_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized == "openapi":
        normalized = "openai"
    if normalized not in SUPPORTED_AI_PROVIDERS:
        raise AiConfigurationError(
            f"Unsupported AI provider: {provider}. Expected one of {', '.join(SUPPORTED_AI_PROVIDERS)}."
        )
    return normalized


def _split_headers(raw: dict[str, Any]) -> dict[str, str]:
    return {str(key): str(value) for key, value in raw.items() if value not in ("", None)}


def _mask_headers(default_headers: dict[str, str]) -> dict[str, str]:
    return {key: _MASKED_HEADER_VALUE for key in default_headers}


def _secret_payload_for_profile(api_key: str | None, default_headers: dict[str, str] | None = None) -> str | None:
    payload: dict[str, object] = {}
    if api_key:
        payload["api_key"] = api_key
    if default_headers:
        payload["default_headers"] = default_headers
    if not payload:
        return None
    return encrypt_secret_payload(payload)


def _is_allowed_ai_host(hostname: str | None) -> bool:
    if not hostname:
        return False
    normalized_host = hostname.strip().lower()
    for allowed_host in settings.allowed_ai_hosts:
        candidate = allowed_host.strip().lower()
        if not candidate:
            continue
        if candidate == "*":
            return True
        if "/" in candidate:
            try:
                if ip_address(normalized_host) in ip_network(candidate, strict=False):
                    return True
            except ValueError:
                continue
        if candidate.startswith(".") and normalized_host.endswith(candidate):
            return True
        if normalized_host == candidate:
            return True
    return False


def _normalize_base_url(base_url: str) -> str:
    parsed = urlsplit(base_url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise AiConfigurationError("AI profile URLs must use http or https.")
    if not parsed.netloc or not parsed.hostname:
        raise AiConfigurationError("AI profile URLs must include a hostname.")
    if parsed.username or parsed.password:
        raise AiConfigurationError("AI profile URLs must not contain embedded credentials.")
    if parsed.query or parsed.fragment:
        raise AiConfigurationError("AI profile URLs must not include query strings or fragments.")
    if not _is_allowed_ai_host(parsed.hostname):
        raise AiConfigurationError(
            "AI profile host is not allowed. Add it to FITNESSPAL_ALLOWED_AI_HOSTS before saving this profile."
        )
    normalized = SplitResult(parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "")
    return urlunsplit(normalized)


def _resolved_profile_from_row(row: AiProfile) -> ResolvedAiProfile:
    secret_payload = decrypt_secret_payload(row.api_key_encrypted)
    encrypted_headers = secret_payload.get("default_headers")
    decrypted_headers = _split_headers(encrypted_headers) if isinstance(encrypted_headers, dict) else {}
    fallback_headers = {
        key: value
        for key, value in _split_headers(row.default_headers_json or {}).items()
        if value != _MASKED_HEADER_VALUE
    }
    return ResolvedAiProfile(
        id=row.id,
        name=row.name,
        provider=row.provider,
        base_url=row.base_url,
        api_key=str(secret_payload.get("api_key")) if secret_payload.get("api_key") else None,
        default_model=row.default_model,
        timeout_seconds=row.timeout_seconds,
        is_enabled=row.is_enabled,
        is_read_only=row.is_read_only,
        default_headers=decrypted_headers or fallback_headers,
        advanced_settings=dict(row.advanced_settings_json or {}),
        models=[str(item) for item in (row.models_json or [])],
        last_reachable=row.last_reachable,
        last_tested_at=row.last_tested_at,
        last_error=row.last_error,
        source="database",
        description=row.description,
    )


def _detect_legacy_provider(base_url: str) -> str:
    lowered = base_url.lower()
    if "ollama" in lowered or ":11434" in lowered:
        return "ollama"
    return "openai"


def _legacy_profile() -> ResolvedAiProfile | None:
    if not settings.local_ai_base_url:
        return None
    normalized_base_url = _normalize_base_url(settings.local_ai_base_url)
    return ResolvedAiProfile(
        id=_LEGACY_PROFILE_ID,
        name="Legacy local AI",
        provider=_detect_legacy_provider(normalized_base_url),
        base_url=normalized_base_url,
        api_key=None,
        default_model=settings.local_ai_model,
        timeout_seconds=settings.local_ai_timeout_seconds,
        is_enabled=True,
        is_read_only=True,
        default_headers={},
        advanced_settings={},
        models=[],
        last_reachable=False,
        last_tested_at=None,
        last_error=None,
        source="legacy",
        description="Read-only fallback sourced from FITNESSPAL_LOCAL_AI_* environment variables.",
    )


def ensure_ai_defaults(session: Session) -> None:
    changed = False
    persona = session.scalar(select(AiPersonaConfig).where(AiPersonaConfig.config_key == "default"))
    if not persona:
        session.add(
            AiPersonaConfig(
                config_key="default",
                display_name=DEFAULT_PERSONA["display_name"],
                tagline=DEFAULT_PERSONA["tagline"],
                system_prompt=DEFAULT_PERSONA["system_prompt"],
                voice_guidelines_json=DEFAULT_PERSONA["voice_guidelines_json"],
            )
        )
        changed = True

    existing_features = {
        row.feature_key
        for row in session.scalars(select(AiFeatureBinding).where(AiFeatureBinding.feature_key.in_(AI_FEATURE_KEYS))).all()
    }
    for feature_key in AI_FEATURE_KEYS:
        if feature_key in existing_features:
            continue
        defaults = DEFAULT_FEATURE_SETTINGS[feature_key]
        session.add(
            AiFeatureBinding(
                feature_key=feature_key,
                temperature=defaults.get("temperature"),
                max_output_tokens=defaults.get("max_output_tokens"),
                request_overrides_json={},
            )
        )
        changed = True

    if changed:
        session.commit()


def get_persona_config(session: Session) -> AiPersonaConfig:
    ensure_ai_defaults(session)
    persona = session.scalar(select(AiPersonaConfig).where(AiPersonaConfig.config_key == "default"))
    assert persona is not None
    return persona


def serialize_persona(persona: AiPersonaConfig) -> dict[str, Any]:
    return {
        "id": persona.id,
        "config_key": persona.config_key,
        "display_name": persona.display_name,
        "tagline": persona.tagline,
        "system_prompt": persona.system_prompt,
        "voice_guidelines_json": persona.voice_guidelines_json or {},
        "updated_at": persona.updated_at.isoformat(),
    }


def serialize_persona_summary(persona: AiPersonaConfig) -> dict[str, Any]:
    return {
        "id": persona.id,
        "config_key": persona.config_key,
        "display_name": persona.display_name,
        "tagline": persona.tagline,
        "updated_at": persona.updated_at.isoformat(),
    }


def _stored_profile_rows(session: Session) -> list[AiProfile]:
    return session.scalars(select(AiProfile).order_by(AiProfile.created_at.asc())).all()


def has_database_profiles(session: Session) -> bool:
    return session.scalar(select(AiProfile.id).limit(1)) is not None


def serialize_profile_summary(profile: ResolvedAiProfile) -> dict[str, Any]:
    return {
        "id": profile.id,
        "name": profile.name,
        "provider": profile.provider,
        "description": profile.description,
        "base_url": profile.base_url,
        "default_model": profile.default_model,
        "timeout_seconds": profile.timeout_seconds,
        "is_enabled": profile.is_enabled,
        "is_read_only": profile.is_read_only,
        "default_headers_json": {},
        "custom_header_keys": sorted(profile.default_headers.keys()),
        "has_custom_headers": bool(profile.default_headers),
        "advanced_settings_json": profile.advanced_settings,
        "models_json": profile.models,
        "last_reachable": profile.last_reachable,
        "last_tested_at": profile.last_tested_at.isoformat() if getattr(profile.last_tested_at, "isoformat", None) else None,
        "last_error": profile.last_error,
        "source": profile.source,
        "has_api_key": bool(profile.api_key),
    }


def list_profiles(session: Session) -> list[dict[str, Any]]:
    ensure_ai_defaults(session)
    rows = _stored_profile_rows(session)
    if rows:
        return [serialize_profile_summary(_resolved_profile_from_row(row)) for row in rows]
    legacy = _legacy_profile()
    return [serialize_profile_summary(legacy)] if legacy else []


def _get_profile_row(session: Session, profile_id: str) -> AiProfile | None:
    return session.get(AiProfile, profile_id)


def get_profile(session: Session, profile_id: str) -> ResolvedAiProfile:
    if profile_id == _LEGACY_PROFILE_ID:
        legacy = _legacy_profile()
        if not legacy:
            raise AiConfigurationError("Legacy AI fallback is not configured.")
        return legacy
    row = _get_profile_row(session, profile_id)
    if not row:
        raise AiConfigurationError("AI profile not found.")
    return _resolved_profile_from_row(row)


def create_profile(
    session: Session,
    *,
    name: str,
    provider: str,
    base_url: str,
    description: str | None,
    api_key: str | None,
    default_model: str | None,
    timeout_seconds: int,
    is_enabled: bool,
    default_headers_json: dict[str, Any],
    advanced_settings_json: dict[str, Any],
) -> dict[str, Any]:
    normalized_provider = _normalize_provider(provider)
    normalized_base_url = _normalize_base_url(base_url)
    default_headers = _split_headers(default_headers_json)
    row = AiProfile(
        name=name.strip(),
        provider=normalized_provider,
        base_url=normalized_base_url,
        description=description.strip() if description else None,
        api_key_encrypted=_secret_payload_for_profile(api_key.strip() if api_key else None, default_headers),
        default_model=default_model.strip() if default_model else None,
        timeout_seconds=timeout_seconds,
        is_enabled=is_enabled,
        default_headers_json=_mask_headers(default_headers),
        advanced_settings_json=dict(advanced_settings_json or {}),
        models_json=[],
        last_reachable=False,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return serialize_profile_summary(_resolved_profile_from_row(row))


def update_profile(
    session: Session,
    profile_id: str,
    *,
    name: str | None = None,
    provider: str | None = None,
    base_url: str | None = None,
    description: str | None = None,
    api_key: str | None = None,
    clear_api_key: bool = False,
    clear_default_headers: bool = False,
    default_model: str | None = None,
    timeout_seconds: int | None = None,
    is_enabled: bool | None = None,
    default_headers_json: dict[str, Any] | None = None,
    advanced_settings_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = _get_profile_row(session, profile_id)
    if not row:
        raise AiConfigurationError("AI profile not found.")
    if row.is_read_only:
        raise AiProfileReadOnlyError("Read-only AI profiles cannot be edited.")
    if name is not None:
        row.name = name.strip()
    if provider is not None:
        row.provider = _normalize_provider(provider)
    if base_url is not None:
        row.base_url = _normalize_base_url(base_url)
    if description is not None:
        row.description = description.strip() or None
    if default_model is not None:
        row.default_model = default_model.strip() or None
    if timeout_seconds is not None:
        row.timeout_seconds = timeout_seconds
    if is_enabled is not None:
        row.is_enabled = is_enabled
    secret_payload = decrypt_secret_payload(row.api_key_encrypted)
    api_key_value = str(secret_payload.get("api_key")) if secret_payload.get("api_key") else None
    default_headers = (
        _split_headers(secret_payload.get("default_headers"))
        if isinstance(secret_payload.get("default_headers"), dict)
        else {
            key: value
            for key, value in _split_headers(row.default_headers_json or {}).items()
            if value != _MASKED_HEADER_VALUE
        }
    )
    if advanced_settings_json is not None:
        row.advanced_settings_json = dict(advanced_settings_json)
    if clear_default_headers:
        default_headers = {}
    elif default_headers_json is not None:
        default_headers = _split_headers(default_headers_json)
    if clear_api_key:
        api_key_value = None
    elif api_key is not None:
        api_key_value = api_key.strip() or None
    row.api_key_encrypted = _secret_payload_for_profile(api_key_value, default_headers)
    row.default_headers_json = _mask_headers(default_headers)
    session.commit()
    session.refresh(row)
    return serialize_profile_summary(_resolved_profile_from_row(row))


def delete_profile(session: Session, profile_id: str) -> None:
    row = _get_profile_row(session, profile_id)
    if not row:
        raise AiConfigurationError("AI profile not found.")
    if row.is_read_only:
        raise AiProfileReadOnlyError("Read-only AI profiles cannot be deleted.")
    for binding in session.scalars(select(AiFeatureBinding).where(AiFeatureBinding.profile_id == row.id)).all():
        binding.profile_id = None
    session.delete(row)
    session.commit()


def get_feature_bindings(session: Session) -> list[dict[str, Any]]:
    ensure_ai_defaults(session)
    rows = session.scalars(select(AiFeatureBinding).order_by(AiFeatureBinding.feature_key.asc())).all()
    profiles = {item["id"]: item for item in list_profiles(session)}
    bindings: list[dict[str, Any]] = []
    for row in rows:
        profile = profiles.get(row.profile_id) if row.profile_id else None
        if not row.profile_id and not has_database_profiles(session):
            legacy = _legacy_profile()
            if legacy:
                profile = serialize_profile_summary(legacy)
        bindings.append(
            {
                "id": row.id,
                "feature_key": row.feature_key,
                "profile_id": row.profile_id if row.profile_id else (profile["id"] if profile and profile["source"] == "legacy" else None),
                "profile": profile,
                "model": row.model,
                "temperature": row.temperature,
                "top_p": row.top_p,
                "max_output_tokens": row.max_output_tokens,
                "system_prompt": row.system_prompt,
                "request_overrides_json": row.request_overrides_json or {},
                "uses_legacy_fallback": bool(not row.profile_id and profile and profile["source"] == "legacy"),
                "updated_at": row.updated_at.isoformat(),
            }
        )
    return bindings


def upsert_feature_bindings(session: Session, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ensure_ai_defaults(session)
    rows = {
        row.feature_key: row
        for row in session.scalars(select(AiFeatureBinding).where(AiFeatureBinding.feature_key.in_(AI_FEATURE_KEYS))).all()
    }
    for payload in payloads:
        feature_key = str(payload["feature_key"])
        if feature_key not in AI_FEATURE_KEYS:
            raise AiConfigurationError(f"Unsupported AI feature: {feature_key}")
        row = rows[feature_key]
        profile_id = payload.get("profile_id")
        if profile_id == _LEGACY_PROFILE_ID:
            row.profile_id = None
        elif profile_id:
            profile = _get_profile_row(session, str(profile_id))
            if not profile:
                raise AiConfigurationError(f"AI profile {profile_id} not found.")
            row.profile_id = profile.id
        else:
            row.profile_id = None
        row.model = str(payload["model"]).strip() if payload.get("model") else None
        row.temperature = float(payload["temperature"]) if payload.get("temperature") not in ("", None) else None
        row.top_p = float(payload["top_p"]) if payload.get("top_p") not in ("", None) else None
        row.max_output_tokens = int(payload["max_output_tokens"]) if payload.get("max_output_tokens") not in ("", None) else None
        row.system_prompt = str(payload["system_prompt"]).strip() if payload.get("system_prompt") else None
        row.request_overrides_json = dict(payload.get("request_overrides_json") or {})
    session.commit()
    return get_feature_bindings(session)


def update_persona(
    session: Session,
    *,
    display_name: str,
    tagline: str,
    system_prompt: str,
    voice_guidelines_json: dict[str, Any],
) -> dict[str, Any]:
    persona = get_persona_config(session)
    persona.display_name = display_name.strip()
    persona.tagline = tagline.strip()
    persona.system_prompt = system_prompt.strip()
    persona.voice_guidelines_json = dict(voice_guidelines_json or {})
    session.commit()
    session.refresh(persona)
    return serialize_persona(persona)


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/chat/completions"
    return f"{normalized}/v1/chat/completions"


def _models_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized.rsplit("/chat/completions", 1)[0] + "/models"
    if normalized.endswith("/v1"):
        return f"{normalized}/models"
    return f"{normalized}/v1/models"


def _ollama_tags_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        normalized = normalized.rsplit("/chat/completions", 1)[0]
    if normalized.endswith("/v1"):
        normalized = normalized.rsplit("/v1", 1)[0]
    return f"{normalized}/api/tags"


def _anthropic_models_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return f"{normalized}/models"
    return f"{normalized}/v1/models"


def _normalize_message_content(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        return "".join(part.get("text", "") for part in message if isinstance(part, dict))
    return str(message)


def _extract_json_payload(raw_message: str) -> dict[str, Any]:
    message = raw_message.strip()
    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", message, re.DOTALL | re.IGNORECASE)
    if fenced_match:
        message = fenced_match.group(1).strip()

    try:
        return json.loads(message)
    except json.JSONDecodeError:
        start = message.find("{")
        end = message.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(message[start : end + 1])


def _image_media_type(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "image/jpeg"


def _build_openai_image_content(image_path: Path) -> dict[str, Any]:
    safe_path = ensure_managed_upload_path(image_path)
    encoded_image = b64encode(safe_path.read_bytes()).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{_image_media_type(safe_path)};base64,{encoded_image}"},
    }


def _build_anthropic_image_content(image_path: Path) -> dict[str, Any]:
    safe_path = ensure_managed_upload_path(image_path)
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": _image_media_type(safe_path),
            "data": b64encode(safe_path.read_bytes()).decode("utf-8"),
        },
    }


def _openai_headers(profile: ResolvedAiProfile) -> dict[str, str]:
    headers = {"Content-Type": "application/json", **profile.default_headers}
    if profile.api_key:
        headers["Authorization"] = f"Bearer {profile.api_key}"
    return headers


def _anthropic_headers(profile: ResolvedAiProfile) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "anthropic-version": profile.default_headers.get("anthropic-version", "2023-06-01"),
        **profile.default_headers,
    }
    if profile.api_key:
        headers["x-api-key"] = profile.api_key
    return headers


def _request_timeout(profile: ResolvedAiProfile) -> int:
    return max(int(profile.timeout_seconds or 60), 5)


def _request_openai_compatible_json(
    profile: ResolvedAiProfile,
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_paths: list[Path] | None,
    request_settings: dict[str, Any],
) -> dict[str, Any]:
    user_content: Any
    if image_paths:
        user_content = [{"type": "text", "text": user_prompt}, *[_build_openai_image_content(path) for path in image_paths]]
    else:
        user_content = user_prompt

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    payload.update({key: value for key, value in request_settings.items() if value is not None})
    if payload.get("max_output_tokens") is not None and payload.get("max_tokens") is None:
        payload["max_tokens"] = payload.pop("max_output_tokens")
    else:
        payload.pop("max_output_tokens", None)
    with httpx.Client(timeout=_request_timeout(profile), headers=_openai_headers(profile), follow_redirects=False) as client:
        response = client.post(_chat_completions_url(profile.base_url), json=payload)
        response.raise_for_status()
        data = response.json()
    raw_message = _normalize_message_content(data["choices"][0]["message"]["content"])
    return _extract_json_payload(raw_message)


def _request_anthropic_json(
    profile: ResolvedAiProfile,
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_paths: list[Path] | None,
    request_settings: dict[str, Any],
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]
    if image_paths:
        content.extend(_build_anthropic_image_content(path) for path in image_paths)
    payload = {
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": int(request_settings.get("max_output_tokens") or request_settings.get("max_tokens") or 1024),
    }
    for key in ("temperature", "top_p"):
        if request_settings.get(key) is not None:
            payload[key] = request_settings[key]
    payload.update(
        {
            key: value
            for key, value in request_settings.items()
            if key not in {"max_output_tokens", "max_tokens", "temperature", "top_p"} and value is not None
        }
    )
    with httpx.Client(timeout=_request_timeout(profile), headers=_anthropic_headers(profile), follow_redirects=False) as client:
        response = client.post(_chat_completions_url(profile.base_url).rsplit("/chat/completions", 1)[0] + "/messages", json=payload)
        response.raise_for_status()
        data = response.json()
    raw_message = "".join(block.get("text", "") for block in data.get("content", []) if isinstance(block, dict))
    return _extract_json_payload(raw_message)


def _request_feature_json(
    resolved: ResolvedAiFeature,
    *,
    system_prompt: str,
    user_prompt: str,
    image_paths: list[Path] | None = None,
    request_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not resolved.profile or not resolved.model:
        raise AiConfigurationError("No AI profile is configured for this feature.")
    request_settings = {**resolved.request_settings, **(request_overrides or {})}
    effective_system_prompt = system_prompt
    if resolved.system_prompt:
        effective_system_prompt = f"{resolved.system_prompt.strip()}\n\n{system_prompt}"

    if resolved.profile.provider in {"openai", "ollama"}:
        return _request_openai_compatible_json(
            resolved.profile,
            model=resolved.model,
            system_prompt=effective_system_prompt,
            user_prompt=user_prompt,
            image_paths=image_paths,
            request_settings=request_settings,
        )
    if resolved.profile.provider == "anthropic":
        return _request_anthropic_json(
            resolved.profile,
            model=resolved.model,
            system_prompt=effective_system_prompt,
            user_prompt=user_prompt,
            image_paths=image_paths,
            request_settings=request_settings,
        )
    raise AiConfigurationError(f"Unsupported AI provider: {resolved.profile.provider}")


def _list_openai_models(profile: ResolvedAiProfile) -> list[str]:
    with httpx.Client(timeout=min(_request_timeout(profile), 15), headers=_openai_headers(profile), follow_redirects=False) as client:
        response = client.get(_models_url(profile.base_url))
        response.raise_for_status()
        data = response.json()
    return [str(item.get("id")) for item in data.get("data", []) if isinstance(item, dict) and item.get("id")]


def _list_anthropic_models(profile: ResolvedAiProfile) -> list[str]:
    with httpx.Client(timeout=min(_request_timeout(profile), 15), headers=_anthropic_headers(profile), follow_redirects=False) as client:
        response = client.get(_anthropic_models_url(profile.base_url))
        response.raise_for_status()
        data = response.json()
    return [str(item.get("id")) for item in data.get("data", []) if isinstance(item, dict) and item.get("id")]


def _list_ollama_models(profile: ResolvedAiProfile) -> list[str]:
    with httpx.Client(timeout=min(_request_timeout(profile), 15), headers=profile.default_headers, follow_redirects=False) as client:
        try:
            response = client.get(_ollama_tags_url(profile.base_url))
            response.raise_for_status()
            data = response.json()
            models = [str(item.get("name")) for item in data.get("models", []) if isinstance(item, dict) and item.get("name")]
            if models:
                return models
        except Exception:
            pass
        response = client.get(_models_url(profile.base_url))
        response.raise_for_status()
        data = response.json()
    return [str(item.get("id")) for item in data.get("data", []) if isinstance(item, dict) and item.get("id")]


def list_models_for_profile(profile: ResolvedAiProfile) -> list[str]:
    if profile.provider == "anthropic":
        return _list_anthropic_models(profile)
    if profile.provider == "ollama":
        return _list_ollama_models(profile)
    return _list_openai_models(profile)


def refresh_profile_models(session: Session, profile_id: str) -> dict[str, Any]:
    profile = get_profile(session, profile_id)
    models = list_models_for_profile(profile)
    if profile.source == "database":
        row = _get_profile_row(session, profile_id)
        assert row is not None
        row.models_json = models
        row.last_reachable = True
        row.last_tested_at = utcnow()
        row.last_error = None
        session.commit()
        session.refresh(row)
        return serialize_profile_summary(_resolved_profile_from_row(row))
    updated = ResolvedAiProfile(
        id=profile.id,
        name=profile.name,
        provider=profile.provider,
        base_url=profile.base_url,
        api_key=profile.api_key,
        default_model=profile.default_model,
        timeout_seconds=profile.timeout_seconds,
        is_enabled=profile.is_enabled,
        is_read_only=profile.is_read_only,
        default_headers=profile.default_headers,
        advanced_settings=profile.advanced_settings,
        models=models,
        last_reachable=True,
        last_tested_at=utcnow(),
        last_error=None,
        source=profile.source,
        description=profile.description,
    )
    return serialize_profile_summary(updated)


def test_profile(session: Session, profile_id: str) -> dict[str, Any]:
    profile = get_profile(session, profile_id)
    try:
        models = list_models_for_profile(profile)
        result = {
            "profile_id": profile.id,
            "reachable": True,
            "available_models": models,
            "selected_model_available": bool(profile.default_model and profile.default_model in models),
            "error": None,
        }
        if profile.source == "database":
            row = _get_profile_row(session, profile_id)
            assert row is not None
            row.models_json = models
            row.last_reachable = True
            row.last_tested_at = utcnow()
            row.last_error = None
            session.commit()
        return result
    except Exception as exc:
        if profile.source == "database":
            row = _get_profile_row(session, profile_id)
            assert row is not None
            row.last_reachable = False
            row.last_tested_at = utcnow()
            row.last_error = str(exc)
            session.commit()
        return {
            "profile_id": profile.id,
            "reachable": False,
            "available_models": [],
            "selected_model_available": False,
            "error": str(exc),
        }


def resolve_feature(session: Session, feature_key: str) -> ResolvedAiFeature:
    ensure_ai_defaults(session)
    row = session.scalar(select(AiFeatureBinding).where(AiFeatureBinding.feature_key == feature_key))
    if not row:
        raise AiConfigurationError(f"Unsupported AI feature: {feature_key}")

    profile: ResolvedAiProfile | None = None
    source = "unconfigured"
    if row.profile_id:
        db_profile = _get_profile_row(session, row.profile_id)
        if db_profile and db_profile.is_enabled:
            profile = _resolved_profile_from_row(db_profile)
            source = "database"
    elif not has_database_profiles(session):
        profile = _legacy_profile()
        if profile:
            source = "legacy"

    request_settings = {
        **(profile.advanced_settings if profile else {}),
        **(row.request_overrides_json or {}),
    }
    if row.temperature is not None:
        request_settings["temperature"] = row.temperature
    if row.top_p is not None:
        request_settings["top_p"] = row.top_p
    if row.max_output_tokens is not None:
        request_settings["max_output_tokens"] = row.max_output_tokens

    return ResolvedAiFeature(
        feature_key=feature_key,
        profile=profile,
        model=row.model or (profile.default_model if profile else None),
        request_settings=request_settings,
        system_prompt=row.system_prompt,
        source=source,
    )


def inspect_ai_runtime(session: Session, *, include_admin_details: bool = False) -> dict[str, Any]:
    ensure_ai_defaults(session)
    persona = serialize_persona_summary(get_persona_config(session))
    all_bindings = get_feature_bindings(session)
    profiles = list_profiles(session) if include_admin_details else []
    bindings = all_bindings if include_admin_details else []
    configured_features = [binding["feature_key"] for binding in all_bindings if binding["profile"]]
    return {
        "profiles": profiles,
        "features": bindings,
        "persona": persona,
        "legacy_mode": bool(not has_database_profiles(session) and settings.local_ai_base_url),
        "configured_feature_count": len(configured_features),
    }


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in ("", None):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _heuristic_guess(image_path: Path) -> dict[str, object]:
    filename = image_path.name.lower()
    library = {
        "chicken": {"label": "Chicken breast", "grams": 180, "calories": 297, "protein_g": 55.8, "carbs_g": 0, "fat_g": 6.5},
        "rice": {"label": "Cooked rice", "grams": 200, "calories": 260, "protein_g": 5.4, "carbs_g": 57.0, "fat_g": 0.6},
        "beef": {"label": "Lean beef", "grams": 180, "calories": 395, "protein_g": 46.8, "carbs_g": 0, "fat_g": 21.6},
        "egg": {"label": "Eggs", "grams": 150, "calories": 215, "protein_g": 18.9, "carbs_g": 1.7, "fat_g": 14.3},
        "oat": {"label": "Oatmeal", "grams": 90, "calories": 350, "protein_g": 12.0, "carbs_g": 60.0, "fat_g": 7.0},
        "salad": {"label": "Mixed salad", "grams": 180, "calories": 120, "protein_g": 5.0, "carbs_g": 16.0, "fat_g": 4.5},
    }

    matches = [value for key, value in library.items() if key in filename]
    if not matches:
        matches = [
            {
                "label": "Unclassified plated meal",
                "grams": 350,
                "calories": 550,
                "protein_g": 30.0,
                "carbs_g": 55.0,
                "fat_g": 20.0,
            }
        ]

    return {
        "provider": "heuristic-fallback",
        "model_name": "filename-heuristic",
        "confidence": 0.35,
        "items": matches,
        "notes": "AI meal-photo backend unavailable; using filename-based heuristic fallback.",
    }


def _heuristic_text_drafts(text: str) -> dict[str, Any]:
    lowered = text.lower()
    warnings: list[str] = []
    drafts: list[dict[str, Any]] = []
    pounds_per_kg = 2.2046226218

    weight_match = re.search(r"(?P<weight>\d+(?:\.\d+)?)\s*(?P<unit>kg|kgs|lb|lbs)", lowered)
    if weight_match and any(keyword in lowered for keyword in ("weigh", "weight", "scale", "morning", "bf")):
        weight_value = float(weight_match.group("weight"))
        weight_unit = weight_match.group("unit")
        weight_kg = weight_value if weight_unit.startswith("kg") else weight_value / pounds_per_kg
        body_fat_match = re.search(r"(?P<body_fat>\d+(?:\.\d+)?)\s*%(\s*bf)?", lowered)
        drafts.append(
            {
                "kind": "weight_entry",
                "summary": f"Log weigh-in at {weight_value:.1f} {'lbs' if weight_unit.startswith('lb') else 'kg'}",
                "payload": {
                    "weight_kg": round(weight_kg, 3),
                    "body_fat_pct": float(body_fat_match.group("body_fat")) if body_fat_match else None,
                },
            }
        )

    meal_match = any(keyword in lowered for keyword in ("ate", "meal", "breakfast", "lunch", "dinner", "snack", "kcal"))
    calories_match = re.search(r"(?P<calories>\d+(?:\.\d+)?)\s*(?:kcal|cal)", lowered)
    protein_match = re.search(r"(?P<protein>\d+(?:\.\d+)?)\s*p(?:rotein)?", lowered)
    carbs_match = re.search(r"(?P<carbs>\d+(?:\.\d+)?)\s*c(?:arbs?)?", lowered)
    fat_match = re.search(r"(?P<fat>\d+(?:\.\d+)?)\s*f(?:at)?", lowered)
    if meal_match and (calories_match or protein_match or carbs_match or fat_match):
        drafts.append(
            {
                "kind": "meal_entry",
                "summary": "Log meal from natural language note",
                "payload": {
                    "meal_type": next((meal_type for meal_type in ("breakfast", "lunch", "dinner", "snack") if meal_type in lowered), "meal"),
                    "notes": text.strip(),
                    "source": "assistant",
                    "items": [
                        {
                            "label": "Assistant quick entry",
                            "calories": _coerce_float(calories_match.group("calories") if calories_match else None),
                            "protein_g": _coerce_float(protein_match.group("protein") if protein_match else None),
                            "carbs_g": _coerce_float(carbs_match.group("carbs") if carbs_match else None),
                            "fat_g": _coerce_float(fat_match.group("fat") if fat_match else None),
                            "source_type": "assistant",
                        }
                    ],
                },
            }
        )

    workout_match = re.search(
        r"(?P<exercise>[a-z][a-z0-9\s\-]+?)\s+(?P<sets>\d+)x(?P<reps>\d+)(?:\s*@\s*(?P<load>\d+(?:\.\d+)?)(?:\s*(?P<load_unit>kg|kgs|lb|lbs))?)?",
        lowered,
    )
    if workout_match:
        exercise_label = workout_match.group("exercise").strip().title()
        sets = int(workout_match.group("sets"))
        reps = int(workout_match.group("reps"))
        load = _coerce_float(workout_match.group("load"))
        if load is not None and (workout_match.group("load_unit") or "").startswith("lb"):
            load = round(load / pounds_per_kg, 3)
        drafts.append(
            {
                "kind": "workout_session",
                "summary": f"Log {sets} sets of {exercise_label}",
                "payload": {
                    "notes": text.strip(),
                    "exercise_name": exercise_label,
                    "sets": [
                        {
                            "exercise_label": exercise_label,
                            "set_index": index + 1,
                            "reps": reps,
                            "load_kg": load,
                            "rir": 2,
                        }
                        for index in range(sets)
                    ],
                },
            }
        )

    if not drafts:
        warnings.append("The local fallback parser could not turn that note into a structured draft.")

    return {"drafts": drafts, "warnings": warnings, "provider": "heuristic-fallback"}


def analyze_meal_photo(session: Session, image_path: Path) -> dict[str, object]:
    try:
        resolved = resolve_feature(session, "meal_photo_estimation")
        parsed = _request_feature_json(
            resolved,
            system_prompt="You estimate meal components and macros from food photos. Return strict JSON only.",
            user_prompt=(
                "Analyze this meal photo for a fitness tracking app. "
                'Respond with strict JSON only, no markdown, with this shape: '
                '{"items":[{"label":"string","grams":number,"calories":number,"protein_g":number,'
                '"carbs_g":number,"fat_g":number,"fiber_g":number,"sodium_mg":number}],'
                '"confidence":number,"notes":"string"}. Prefer conservative portion estimates when uncertain.'
            ),
            image_paths=[image_path],
        )
        items = parsed.get("items", [])
        return {
            "provider": resolved.profile.provider if resolved.profile else "unknown",
            "model_name": resolved.model,
            "confidence": float(parsed.get("confidence", 0.55)),
            "items": items if isinstance(items, list) else [],
            "notes": parsed.get("notes"),
        }
    except Exception:
        return _heuristic_guess(image_path)


def analyze_nutrition_label(session: Session, image_path: Path) -> dict[str, Any]:
    resolved = resolve_feature(session, "nutrition_label_scan")
    if not resolved.profile or not resolved.model:
        raise AiConfigurationError("Nutrition label scanning needs an AI backend. Configure the nutrition_label_scan feature in Settings.")
    parsed = _request_feature_json(
        resolved,
        system_prompt="You extract nutrition-label data from images. Return strict JSON only.",
        user_prompt=(
            "Read this nutrition label and return strict JSON only with this shape: "
            '{"name":"string","brand":"string|null","serving_name":"string|null","calories":number,'
            '"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,'
            '"sodium_mg":number,"notes":"string|null"}. '
            "If the image is unclear, use conservative estimates and explain uncertainty in notes."
        ),
        image_paths=[image_path],
    )
    return {
        "provider": resolved.profile.provider if resolved.profile else "unknown",
        "model_name": resolved.model,
        "food": {
            "name": str(parsed.get("name") or "Scanned food"),
            "brand": parsed.get("brand"),
            "serving_name": parsed.get("serving_name"),
            "calories": _coerce_float(parsed.get("calories")),
            "protein_g": _coerce_float(parsed.get("protein_g")),
            "carbs_g": _coerce_float(parsed.get("carbs_g")),
            "fat_g": _coerce_float(parsed.get("fat_g")),
            "fiber_g": _coerce_float(parsed.get("fiber_g")),
            "sugar_g": _coerce_float(parsed.get("sugar_g")),
            "sodium_mg": _coerce_float(parsed.get("sodium_mg")),
            "notes": parsed.get("notes"),
        },
    }


def parse_natural_language_entry(session: Session, text: str) -> dict[str, Any]:
    try:
        resolved = resolve_feature(session, "assistant_quick_capture")
        parsed = _request_feature_json(
            resolved,
            system_prompt=(
                "You translate free-form fitness notes into reviewable action drafts. "
                "Return strict JSON only and never assume unknown values."
            ),
            user_prompt=(
                "Convert this note into reviewable fitness logging drafts. "
                'Return strict JSON only with this shape: {"drafts":[{"kind":"meal_entry|weight_entry|workout_session",'
                '"summary":"string","payload":object}],"warnings":["string"]}. '
                "For meal drafts, payload should use FitnessPal meal create fields with an items array. "
                "For weight drafts, payload should use weight entry create fields. "
                "For workout drafts, payload should include notes plus a sets array where each set has "
                "exercise_label, set_index, reps, load_kg, and optional rir. "
                f"Note: {text}"
            ),
        )
        drafts = parsed.get("drafts", [])
        warnings = parsed.get("warnings", [])
        return {
            "drafts": drafts if isinstance(drafts, list) else [],
            "warnings": warnings if isinstance(warnings, list) else [],
            "provider": resolved.profile.provider if resolved.profile else "unknown",
            "model_name": resolved.model,
        }
    except Exception:
        return _heuristic_text_drafts(text)


def _coach_brief_fallback(persona: AiPersonaConfig, payload: dict[str, Any]) -> dict[str, Any]:
    recommendations = list(payload.get("recommendations") or [])
    recovery_flags = list(payload.get("recovery_flags") or [])
    nutrition = payload.get("nutrition", {})
    training = payload.get("training", {})
    body = payload.get("body", {})

    title = "Daily Brief"
    if recovery_flags:
        summary = f"{persona.display_name}: recovery is the watch item today. {recovery_flags[0]}"
    elif recommendations:
        summary = f"{persona.display_name}: primary move today is to {recommendations[0][0].lower() + recommendations[0][1:]}"
    else:
        summary = f"{persona.display_name}: no major warnings. Keep stacking consistent entries."

    actions = recommendations[:3] or [
        "Log your next meal and workout so the coach can tighten tomorrow's read.",
        "Keep entries honest and fast; the coach works best when the data is fresh.",
    ]
    body_markdown = (
        f"**{persona.display_name} says:** {summary}\n\n"
        f"- Avg calories (7d): {round(nutrition.get('average_calories_7') or 0)}\n"
        f"- Weekly volume: {round(training.get('weekly_volume_kg') or 0)} kg\n"
        f"- Weight trend: {body.get('weight_trend_kg_per_week') or 0:.2f} kg/week"
    )
    return {
        "source": "deterministic",
        "provider": None,
        "model_name": None,
        "title": title,
        "summary": summary,
        "body_markdown": body_markdown,
        "actions_json": actions,
        "stats_json": {
            "average_calories_7": round(nutrition.get("average_calories_7") or 0),
            "weekly_volume_kg": round(training.get("weekly_volume_kg") or 0),
            "weight_trend_kg_per_week": round(body.get("weight_trend_kg_per_week") or 0, 2),
            "pr_count": training.get("pr_count") or 0,
        },
        "error_message": None,
    }


def _string_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    result: list[str] = []
    for item in items:
        text = str(item).strip()
        if text:
            result.append(text)
    return result


def _coach_stats_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    nutrition = payload.get("nutrition", {})
    training = payload.get("training", {})
    body = payload.get("body", {})
    return {
        "average_calories_7": round(nutrition.get("average_calories_7") or 0),
        "goal_calories": round(nutrition.get("goal_calories") or 0) if nutrition.get("goal_calories") else None,
        "adherence_ratio": round(nutrition.get("adherence_ratio") or 0, 3) if nutrition.get("adherence_ratio") is not None else None,
        "weekly_volume_kg": round(training.get("weekly_volume_kg") or 0),
        "volume_delta_kg": round(training.get("volume_delta_kg") or 0),
        "session_count_7": int(training.get("session_count_7") or 0),
        "pr_count": int(training.get("pr_count") or 0),
        "latest_weight_kg": round(body.get("latest_weight_kg") or 0, 1) if body.get("latest_weight_kg") is not None else None,
        "weight_trend_kg_per_week": round(body.get("weight_trend_kg_per_week") or 0, 2),
    }


def _coach_stats_with_overrides(payload: dict[str, Any], overrides: Any) -> dict[str, Any]:
    stats = _coach_stats_from_payload(payload)
    if isinstance(overrides, dict):
        stats.update(overrides)
    return stats


def _serialize_recent_meal_context(rows: list[MealEntry]) -> list[dict[str, Any]]:
    return [
        {
            "meal_type": row.meal_type,
            "calories": row.total_calories,
            "protein_g": row.total_protein_g,
            "carbs_g": row.total_carbs_g,
            "fat_g": row.total_fat_g,
            "logged_at": row.logged_at.isoformat(),
            "notes": row.notes,
        }
        for row in rows
    ]


def _serialize_recent_workout_context(rows: list[WorkoutSession]) -> list[dict[str, Any]]:
    return [
        {
            "notes": row.notes,
            "volume_kg": row.total_volume_kg,
            "sets": row.total_sets,
            "perceived_energy": row.perceived_energy,
            "bodyweight_kg": row.bodyweight_kg,
            "started_at": row.started_at.isoformat(),
        }
        for row in rows
    ]


def _serialize_recent_weight_context(rows: list[WeightEntry]) -> list[dict[str, Any]]:
    return [
        {
            "weight_kg": row.weight_kg,
            "body_fat_pct": row.body_fat_pct,
            "waist_cm": row.waist_cm,
            "logged_at": row.logged_at.isoformat(),
            "notes": row.notes,
        }
        for row in rows
    ]


def _serialize_goal_context(rows: list[Goal]) -> list[dict[str, Any]]:
    return [
        {
            "title": row.title,
            "category": row.category,
            "metric_key": row.metric_key,
            "target_value": row.target_value,
            "unit": row.unit,
            "period": row.period,
            "notes": row.notes,
        }
        for row in rows
    ]


def _load_coach_context(session: Session, user_id: str, insight_payload: dict[str, Any]) -> dict[str, Any]:
    recent_meals = session.scalars(
        select(MealEntry).where(MealEntry.user_id == user_id, MealEntry.deleted_at.is_(None)).order_by(MealEntry.logged_at.desc()).limit(5)
    ).all()
    recent_workouts = session.scalars(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user_id, WorkoutSession.deleted_at.is_(None))
        .order_by(WorkoutSession.started_at.desc())
        .limit(3)
    ).all()
    recent_weights = session.scalars(
        select(WeightEntry).where(WeightEntry.user_id == user_id, WeightEntry.deleted_at.is_(None)).order_by(WeightEntry.logged_at.desc()).limit(3)
    ).all()
    active_goals = session.scalars(
        select(Goal).where(Goal.user_id == user_id, Goal.deleted_at.is_(None), Goal.is_active.is_(True)).order_by(Goal.created_at.desc())
    ).all()
    return {
        "nutrition_snapshot": insight_payload.get("nutrition", {}),
        "body_snapshot": insight_payload.get("body", {}),
        "training_snapshot": insight_payload.get("training", {}),
        "recovery_flags": insight_payload.get("recovery_flags", []),
        "recommendations": insight_payload.get("recommendations", []),
        "coach_stats": _coach_stats_from_payload(insight_payload),
        "recent_meals": _serialize_recent_meal_context(recent_meals),
        "recent_workouts": _serialize_recent_workout_context(recent_workouts),
        "recent_weights": _serialize_recent_weight_context(recent_weights),
        "goals": _serialize_goal_context(active_goals),
    }


def _coach_default_system_prompt(persona: AiPersonaConfig) -> str:
    return (
        f"{persona.system_prompt.strip()}\n\n"
        "You are the user's dedicated strength, nutrition, body-composition, and recovery coach inside FitnessPal. "
        "Give tailored coaching, not generic wellness advice. Prioritize the athlete's active goals, recent adherence, "
        "training stress, recovery flags, and bodyweight trend. Use only the supplied context. If something is unknown, "
        "say it is unknown and ask for the next most useful check-in. Keep the tone direct, sharp, supportive, and "
        "practical. Avoid fluff, avoid medical claims, and never imply that you already changed the athlete's data.\n\n"
        f"Coach voice guidelines: {json.dumps(persona.voice_guidelines_json or {}, default=str)}"
    )


def _build_coach_context_prompt(persona: AiPersonaConfig, context: dict[str, Any], *, athlete_request: str, task: str) -> str:
    context_payload = {
        "persona": {
            "display_name": persona.display_name,
            "tagline": persona.tagline,
        },
        "task": task,
        "athlete_request": athlete_request.strip(),
        "context": context,
    }
    return (
        "Use the context JSON below to answer the athlete. Tailor the response to the athlete_request, "
        "prioritize the next 24 to 72 hours, and call out missing context when it matters.\n\n"
        f"{json.dumps(context_payload, default=str)}"
    )


def generate_coach_brief(session: Session, user_id: str, insight_payload: dict[str, Any]) -> dict[str, Any]:
    persona = get_persona_config(session)
    context = _load_coach_context(session, user_id, insight_payload)

    try:
        resolved = resolve_feature(session, "coach_brief")
        parsed = _request_feature_json(
            resolved,
            system_prompt=(
                f"{_coach_default_system_prompt(persona)}\n\n"
                "Generate a grounded daily coach brief from the provided fitness data. Return strict JSON only with this shape: "
                '{"title":"string","summary":"string","body_markdown":"string","actions":["string"],"stats":{"key":"value"}}. '
                "Keep it concise, high-signal, and specific to the athlete's current logs. Do not pretend to know data that is not present."
            ),
            user_prompt=_build_coach_context_prompt(
                persona,
                context,
                athlete_request="Give me today's coach read and the next moves that matter most.",
                task="Generate a concise daily coach brief from the current fitness logs.",
            ),
        )
        return {
            "source": "ai",
            "provider": resolved.profile.provider if resolved.profile else None,
            "model_name": resolved.model,
            "title": str(parsed.get("title") or "Daily Brief"),
            "summary": str(parsed.get("summary") or ""),
            "body_markdown": str(parsed.get("body_markdown") or ""),
            "actions_json": _string_list(parsed.get("actions")),
            "stats_json": _coach_stats_with_overrides(insight_payload, parsed.get("stats")),
            "error_message": None,
        }
    except Exception:
        return _coach_brief_fallback(persona, insight_payload)


def _coach_advice_fallback(persona: AiPersonaConfig, athlete_request: str, payload: dict[str, Any]) -> dict[str, Any]:
    recommendations = _string_list(payload.get("recommendations"))
    recovery_flags = _string_list(payload.get("recovery_flags"))
    focus_area = "Recovery management" if recovery_flags else ("Primary lever" if recommendations else "Consistency")
    primary_take = recovery_flags[0] if recovery_flags else (
        recommendations[0] if recommendations else "stay consistent with logging, meals, and the next planned session"
    )
    actions = recommendations[:3] or [
        "Keep the next meal high in protein and close to your normal calorie target.",
        "Make the next workout technically clean before adding more load.",
        "Log the next weigh-in under the same conditions so the trend stays useful.",
    ]
    watchouts = recovery_flags[:3]
    follow_up_prompt = (
        "How did your last training session feel for energy, pumps, and recovery?"
        if recovery_flags
        else "Which part of the day is hardest for you to stay on plan with right now?"
    )
    return {
        "source": "deterministic",
        "provider": None,
        "model_name": None,
        "question": athlete_request.strip(),
        "title": "Coach answer",
        "summary": f"{persona.display_name}: the main focus right now is to {primary_take[0].lower() + primary_take[1:] if primary_take else 'stay steady.'}",
        "body_markdown": (
            f"Question: {athlete_request.strip()}\n\n"
            f"Based on the current logs, the clearest coaching priority is to {primary_take[0].lower() + primary_take[1:] if primary_take else 'stay consistent.'} "
            "Treat the next 24 to 72 hours as an execution block instead of chasing random changes."
        ),
        "actions": actions,
        "watchouts": watchouts,
        "focus_area": focus_area,
        "follow_up_prompt": follow_up_prompt,
        "stats": _coach_stats_from_payload(payload),
        "generated_at": utcnow().isoformat(),
    }


def generate_coach_advice(session: Session, user_id: str, insight_payload: dict[str, Any], athlete_request: str) -> dict[str, Any]:
    persona = get_persona_config(session)
    cleaned_request = athlete_request.strip()
    context = _load_coach_context(session, user_id, insight_payload)

    try:
        resolved = resolve_feature(session, "coach_brief")
        parsed = _request_feature_json(
            resolved,
            system_prompt=(
                f"{_coach_default_system_prompt(persona)}\n\n"
                "Answer the athlete's question as their in-app coach. Return strict JSON only with this shape: "
                '{"title":"string","summary":"string","body_markdown":"string","actions":["string"],'
                '"watchouts":["string"],"focus_area":"string","follow_up_prompt":"string","stats":{"key":"value"}}. '
                "Give a tailored answer, explain the coaching logic briefly, and keep the advice grounded in the supplied data."
            ),
            user_prompt=_build_coach_context_prompt(
                persona,
                context,
                athlete_request=cleaned_request,
                task="Answer the athlete's question with tailored coaching based on the current fitness logs.",
            ),
        )
        return {
            "source": "ai",
            "provider": resolved.profile.provider if resolved.profile else None,
            "model_name": resolved.model,
            "question": cleaned_request,
            "title": str(parsed.get("title") or "Coach answer"),
            "summary": str(parsed.get("summary") or ""),
            "body_markdown": str(parsed.get("body_markdown") or ""),
            "actions": _string_list(parsed.get("actions")),
            "watchouts": _string_list(parsed.get("watchouts")),
            "focus_area": str(parsed.get("focus_area") or "Coach read"),
            "follow_up_prompt": str(parsed.get("follow_up_prompt") or "").strip() or None,
            "stats": _coach_stats_with_overrides(insight_payload, parsed.get("stats")),
            "generated_at": utcnow().isoformat(),
        }
    except Exception:
        return _coach_advice_fallback(persona, cleaned_request, insight_payload)


def get_latest_coach_brief(session: Session, user_id: str) -> CoachBrief | None:
    return session.scalars(
        select(CoachBrief).where(CoachBrief.user_id == user_id).order_by(CoachBrief.created_at.desc()).limit(1)
    ).first()


def serialize_coach_brief(row: CoachBrief, persona: AiPersonaConfig | None = None) -> dict[str, Any]:
    active_persona = persona or DEFAULT_PERSONA
    display_name = active_persona.display_name if isinstance(active_persona, AiPersonaConfig) else str(active_persona["display_name"])
    tagline = active_persona.tagline if isinstance(active_persona, AiPersonaConfig) else str(active_persona["tagline"])
    return {
        "id": row.id,
        "status": row.status,
        "source": row.source,
        "provider": row.provider,
        "model_name": row.model_name,
        "title": row.title,
        "summary": row.summary,
        "body_markdown": row.body_markdown,
        "actions": row.actions_json or [],
        "stats": row.stats_json or {},
        "error_message": row.error_message,
        "persona_name": display_name,
        "persona_tagline": tagline,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def refresh_coach_brief(session: Session, user_id: str, snapshot: InsightSnapshot) -> CoachBrief:
    payload = generate_coach_brief(session, user_id, snapshot.payload_json)
    row = CoachBrief(
        user_id=user_id,
        insight_snapshot_id=snapshot.id,
        status="ready",
        source=str(payload.get("source") or "deterministic"),
        provider=payload.get("provider"),
        model_name=payload.get("model_name"),
        title=str(payload.get("title") or "Daily Brief"),
        summary=str(payload.get("summary") or ""),
        body_markdown=str(payload.get("body_markdown") or ""),
        actions_json=[str(item) for item in payload.get("actions_json", [])],
        stats_json=dict(payload.get("stats_json") or {}),
        error_message=payload.get("error_message"),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
