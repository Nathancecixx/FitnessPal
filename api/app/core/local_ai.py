from __future__ import annotations

from base64 import b64encode
import json
from pathlib import Path

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
    }


def analyze_meal_photo(image_path: Path) -> dict[str, object]:
    if not settings.local_ai_base_url:
        return _heuristic_guess(image_path)

    image_bytes = image_path.read_bytes()
    encoded_image = b64encode(image_bytes).decode("utf-8")
    prompt = (
        "Analyze the meal photo and respond strictly as JSON with this shape: "
        '{"items":[{"label":"string","grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],'
        '"confidence":number,"notes":"string"}. Use best-effort portion estimates.'
    )
    payload = {
        "model": settings.local_ai_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"},
                    },
                ],
            }
        ],
        "temperature": 0.2,
    }

    try:
        with httpx.Client(timeout=settings.local_ai_timeout_seconds) as client:
            response = client.post(f"{settings.local_ai_base_url.rstrip('/')}/chat/completions", json=payload)
            response.raise_for_status()
            data = response.json()
        message = data["choices"][0]["message"]["content"]
        if isinstance(message, list):
            message = "".join(part.get("text", "") for part in message if isinstance(part, dict))
        parsed = json.loads(message)
        return {
            "provider": "openai-compatible",
            "model_name": settings.local_ai_model,
            "confidence": float(parsed.get("confidence", 0.55)),
            "items": parsed.get("items", []),
            "notes": parsed.get("notes"),
        }
    except Exception:
        return _heuristic_guess(image_path)
