from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings


settings = get_settings()


def _first_number(source: dict[str, Any], *keys: str) -> float:
    for key in keys:
        value = source.get(key)
        if value in ("", None):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def lookup_barcode_product(barcode: str) -> dict[str, Any]:
    normalized = "".join(character for character in barcode if character.isdigit())
    if len(normalized) < 8:
        raise ValueError("Barcode must include at least 8 digits.")

    with httpx.Client(
        base_url=settings.barcode_lookup_base_url.rstrip("/"),
        timeout=settings.barcode_lookup_timeout_seconds,
        headers={"User-Agent": settings.barcode_lookup_user_agent},
    ) as client:
        response = client.get(f"/api/v2/product/{normalized}.json")
        response.raise_for_status()
        payload = response.json()

    product = payload.get("product")
    if not isinstance(product, dict):
        raise ValueError("Product not found in barcode lookup source.")

    nutriments = product.get("nutriments", {})
    if not isinstance(nutriments, dict):
        nutriments = {}

    salt_g = _first_number(nutriments, "salt_100g")
    sodium_mg = _first_number(nutriments, "sodium_100g") * 1000
    if sodium_mg == 0 and salt_g:
        sodium_mg = (salt_g / 2.5) * 1000

    return {
        "source": "openfoodfacts",
        "barcode": normalized,
        "food": {
            "name": product.get("product_name") or product.get("product_name_en") or f"Barcode {normalized}",
            "brand": product.get("brands"),
            "serving_name": product.get("serving_size"),
            "calories": _first_number(nutriments, "energy-kcal_100g", "energy-kcal"),
            "protein_g": _first_number(nutriments, "proteins_100g", "proteins"),
            "carbs_g": _first_number(nutriments, "carbohydrates_100g", "carbohydrates"),
            "fat_g": _first_number(nutriments, "fat_100g", "fat"),
            "fiber_g": _first_number(nutriments, "fiber_100g", "fiber"),
            "sugar_g": _first_number(nutriments, "sugars_100g", "sugars"),
            "sodium_mg": round(sodium_mg, 1),
            "notes": f"Imported from OpenFoodFacts barcode {normalized}.",
        },
    }
