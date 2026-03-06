from __future__ import annotations

from base64 import b64encode
import json
from pathlib import Path
import re
from typing import Any

import httpx

from app.core.config import get_settings


settings = get_settings()


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
        "notes": "Local AI unavailable; using filename-based heuristic fallback.",
    }


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


def inspect_local_ai() -> dict[str, Any]:
    if not settings.local_ai_base_url:
        return {
            "configured": False,
            "reachable": False,
            "available_models": [],
            "selected_model_available": False,
            "error": "Local AI base URL is not configured.",
        }

    try:
        with httpx.Client(timeout=min(settings.local_ai_timeout_seconds, 10)) as client:
            response = client.get(_models_url(settings.local_ai_base_url))
            response.raise_for_status()
            data = response.json()
        items = data.get("data", [])
        models = [item.get("id", "") for item in items if isinstance(item, dict) and item.get("id")]
        return {
            "configured": True,
            "reachable": True,
            "available_models": models,
            "selected_model_available": settings.local_ai_model in models,
            "error": None,
        }
    except Exception as model_error:
        try:
            with httpx.Client(timeout=min(settings.local_ai_timeout_seconds, 10)) as client:
                response = client.get(_ollama_tags_url(settings.local_ai_base_url))
                response.raise_for_status()
                data = response.json()
            items = data.get("models", [])
            models = [item.get("name", "") for item in items if isinstance(item, dict) and item.get("name")]
            return {
                "configured": True,
                "reachable": True,
                "available_models": models,
                "selected_model_available": settings.local_ai_model in models,
                "error": None,
            }
        except Exception:
            return {
                "configured": True,
                "reachable": False,
                "available_models": [],
                "selected_model_available": False,
                "error": str(model_error),
            }


def analyze_meal_photo(image_path: Path) -> dict[str, object]:
    if not settings.local_ai_base_url:
        return _heuristic_guess(image_path)

    image_bytes = image_path.read_bytes()
    encoded_image = b64encode(image_bytes).decode("utf-8")
    prompt = (
        "Analyze this meal photo for a fitness tracking app. "
        "Respond with strict JSON only, no markdown, with this shape: "
        '{"items":[{"label":"string","grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sodium_mg":number}],"confidence":number,"notes":"string"}. '
        "Prefer conservative portion estimates when uncertain."
    )
    payload = {
        "model": settings.local_ai_model,
        "messages": [
            {
                "role": "system",
                "content": "You estimate meal components and macros from food photos. Return strict JSON only.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"},
                    },
                ],
            },
        ],
        "temperature": 0.2,
        "stream": False,
    }

    try:
        with httpx.Client(timeout=settings.local_ai_timeout_seconds) as client:
            response = client.post(_chat_completions_url(settings.local_ai_base_url), json=payload)
            response.raise_for_status()
            data = response.json()
        raw_message = _normalize_message_content(data["choices"][0]["message"]["content"])
        parsed = _extract_json_payload(raw_message)
        items = parsed.get("items", [])
        return {
            "provider": "openai-compatible-local",
            "model_name": settings.local_ai_model,
            "confidence": float(parsed.get("confidence", 0.55)),
            "items": items if isinstance(items, list) else [],
            "notes": parsed.get("notes"),
        }
    except Exception:
        return _heuristic_guess(image_path)
