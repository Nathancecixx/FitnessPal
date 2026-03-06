from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import mean


@dataclass(slots=True)
class MacroProfile:
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    sodium_mg: float = 0

    def add(self, other: "MacroProfile") -> "MacroProfile":
        return MacroProfile(
            calories=self.calories + other.calories,
            protein_g=self.protein_g + other.protein_g,
            carbs_g=self.carbs_g + other.carbs_g,
            fat_g=self.fat_g + other.fat_g,
            fiber_g=self.fiber_g + other.fiber_g,
            sodium_mg=self.sodium_mg + other.sodium_mg,
        )


@dataclass(slots=True)
class SetPerformance:
    reps: int
    load_kg: float
    rir: float | None = None
    completed_at: datetime | None = None


@dataclass(slots=True)
class ProgressionContext:
    rep_target_min: int
    rep_target_max: int
    load_increment: float
    recent_sets: list[SetPerformance]
    calorie_adherence: float | None = None
    weight_trend_kg_per_week: float | None = None


def scale_macros(per_100g: MacroProfile, grams: float | None) -> MacroProfile:
    if not grams:
        return MacroProfile()
    ratio = grams / 100
    return MacroProfile(
        calories=per_100g.calories * ratio,
        protein_g=per_100g.protein_g * ratio,
        carbs_g=per_100g.carbs_g * ratio,
        fat_g=per_100g.fat_g * ratio,
        fiber_g=per_100g.fiber_g * ratio,
        sodium_mg=per_100g.sodium_mg * ratio,
    )


def aggregate_macros(items: list[MacroProfile]) -> MacroProfile:
    total = MacroProfile()
    for item in items:
        total = total.add(item)
    return total


def recipe_per_serving(items: list[MacroProfile], servings: float) -> MacroProfile:
    totals = aggregate_macros(items)
    if servings <= 0:
        return totals
    return MacroProfile(
        calories=totals.calories / servings,
        protein_g=totals.protein_g / servings,
        carbs_g=totals.carbs_g / servings,
        fat_g=totals.fat_g / servings,
        fiber_g=totals.fiber_g / servings,
        sodium_mg=totals.sodium_mg / servings,
    )


def rolling_average(values: list[float], window: int) -> list[float]:
    if not values:
        return []
    output: list[float] = []
    for idx in range(len(values)):
        start = max(0, idx - window + 1)
        output.append(mean(values[start : idx + 1]))
    return output


def weight_trend_per_week(weights: list[float]) -> float:
    if len(weights) < 2:
        return 0
    smoothed = rolling_average(weights, window=min(7, len(weights)))
    start = smoothed[0]
    end = smoothed[-1]
    weeks = max(len(weights) / 7, 1 / 7)
    return (end - start) / weeks


def recommend_progression(context: ProgressionContext) -> dict[str, float | str]:
    working_sets = [entry for entry in context.recent_sets if entry.load_kg > 0 and entry.reps > 0]
    if not working_sets:
        return {
            "recommendation": "hold",
            "next_load_kg": 0.0,
            "reason": "No prior working sets logged yet.",
        }

    best_load = max(entry.load_kg for entry in working_sets)
    top_sets = [entry for entry in working_sets if entry.load_kg == best_load]
    avg_reps = mean(entry.reps for entry in top_sets)
    readiness_penalty = 0

    if context.calorie_adherence is not None and context.calorie_adherence < 0.75:
        readiness_penalty += 1
    if context.weight_trend_kg_per_week is not None and context.weight_trend_kg_per_week < -0.5:
        readiness_penalty += 1

    if avg_reps >= context.rep_target_max and readiness_penalty == 0:
        return {
            "recommendation": "add_load",
            "next_load_kg": round(best_load + context.load_increment, 2),
            "reason": "You hit the top of the rep range with stable recovery signals.",
        }

    if avg_reps < context.rep_target_min and readiness_penalty >= 1:
        return {
            "recommendation": "deload",
            "next_load_kg": round(max(best_load - context.load_increment, 0), 2),
            "reason": "Performance is below target and recovery signals are negative.",
        }

    if avg_reps < context.rep_target_max:
        return {
            "recommendation": "add_reps",
            "next_load_kg": round(best_load, 2),
            "reason": "Keep load steady and add reps inside the target range.",
        }

    return {
        "recommendation": "hold",
        "next_load_kg": round(best_load, 2),
        "reason": "Maintain load while consolidating recent performance.",
    }
