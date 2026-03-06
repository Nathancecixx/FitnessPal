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


def _image_media_type(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "image/jpeg"


def _build_image_content(image_path: Path) -> dict[str, Any]:
    encoded_image = b64encode(image_path.read_bytes()).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{_image_media_type(image_path)};base64,{encoded_image}"},
    }


def _request_local_ai_json(messages: list[dict[str, Any]], temperature: float = 0.2) -> dict[str, Any]:
    if not settings.local_ai_base_url:
        raise RuntimeError("Local AI base URL is not configured.")

    payload = {
        "model": settings.local_ai_model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    with httpx.Client(timeout=settings.local_ai_timeout_seconds) as client:
        response = client.post(_chat_completions_url(settings.local_ai_base_url), json=payload)
        response.raise_for_status()
        data = response.json()
    raw_message = _normalize_message_content(data["choices"][0]["message"]["content"])
    return _extract_json_payload(raw_message)


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in ("", None):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _heuristic_text_drafts(text: str) -> dict[str, Any]:
    lowered = text.lower()
    warnings: list[str] = []
    drafts: list[dict[str, Any]] = []

    weight_match = re.search(r"(?P<weight>\d+(?:\.\d+)?)\s*kg", lowered)
    if weight_match and any(keyword in lowered for keyword in ("weigh", "weight", "scale", "morning", "bf")):
        weight_value = float(weight_match.group("weight"))
        body_fat_match = re.search(r"(?P<body_fat>\d+(?:\.\d+)?)\s*%(\s*bf)?", lowered)
        drafts.append(
            {
                "kind": "weight_entry",
                "summary": f"Log weigh-in at {weight_value:.1f} kg",
                "payload": {
                    "weight_kg": weight_value,
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
        r"(?P<exercise>[a-z][a-z0-9\s\-]+?)\s+(?P<sets>\d+)x(?P<reps>\d+)(?:\s*@\s*(?P<load>\d+(?:\.\d+)?))?",
        lowered,
    )
    if workout_match:
        exercise_label = workout_match.group("exercise").strip().title()
        sets = int(workout_match.group("sets"))
        reps = int(workout_match.group("reps"))
        load = _coerce_float(workout_match.group("load"))
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

    try:
        parsed = _request_local_ai_json(
            [
                {
                    "role": "system",
                    "content": "You estimate meal components and macros from food photos. Return strict JSON only.",
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this meal photo for a fitness tracking app. "
                                'Respond with strict JSON only, no markdown, with this shape: '
                                '{"items":[{"label":"string","grams":number,"calories":number,"protein_g":number,'
                                '"carbs_g":number,"fat_g":number,"fiber_g":number,"sodium_mg":number}],'
                                '"confidence":number,"notes":"string"}. Prefer conservative portion estimates when uncertain.'
                            ),
                        },
                        _build_image_content(image_path),
                    ],
                },
            ]
        )
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


def analyze_nutrition_label(image_path: Path) -> dict[str, Any]:
    parsed = _request_local_ai_json(
        [
            {
                "role": "system",
                "content": "You extract nutrition-label data from images. Return strict JSON only.",
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Read this nutrition label and return strict JSON only with this shape: "
                            '{"name":"string","brand":"string|null","serving_name":"string|null","calories":number,'
                            '"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,'
                            '"sodium_mg":number,"notes":"string|null"}. '
                            "If the image is unclear, use conservative estimates and explain uncertainty in notes."
                        ),
                    },
                    _build_image_content(image_path),
                ],
            },
        ]
    )
    return {
        "provider": "openai-compatible-local",
        "model_name": settings.local_ai_model,
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


def parse_natural_language_entry(text: str) -> dict[str, Any]:
    if not settings.local_ai_base_url:
        return _heuristic_text_drafts(text)

    try:
        parsed = _request_local_ai_json(
            [
                {
                    "role": "system",
                    "content": (
                        "You translate free-form fitness notes into reviewable action drafts. "
                        "Return strict JSON only and never assume unknown values."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Convert this note into reviewable fitness logging drafts. "
                        'Return strict JSON only with this shape: {"drafts":[{"kind":"meal_entry|weight_entry|workout_session",'
                        '"summary":"string","payload":object}],"warnings":["string"]}. '
                        "For meal drafts, payload should use FitnessPal meal create fields with an items array. "
                        "For weight drafts, payload should use weight entry create fields. "
                        "For workout drafts, payload should include notes plus a sets array where each set has "
                        "exercise_label, set_index, reps, load_kg, and optional rir. "
                        f"Note: {text}"
                    ),
                },
            ]
        )
        drafts = parsed.get("drafts", [])
        warnings = parsed.get("warnings", [])
        return {
            "drafts": drafts if isinstance(drafts, list) else [],
            "warnings": warnings if isinstance(warnings, list) else [],
            "provider": "openai-compatible-local",
            "model_name": settings.local_ai_model,
        }
    except Exception:
        return _heuristic_text_drafts(text)
