from __future__ import annotations

import unittest

from app.core.logic import (
    MacroProfile,
    ProgressionContext,
    SetPerformance,
    aggregate_macros,
    recommend_progression,
    recipe_per_serving,
    scale_macros,
    weight_trend_per_week,
)


class NutritionLogicTests(unittest.TestCase):
    def test_scale_macros_from_food_weight(self) -> None:
        chicken = MacroProfile(calories=165, protein_g=31, carbs_g=0, fat_g=3.6)
        scaled = scale_macros(chicken, grams=150)
        self.assertAlmostEqual(scaled.calories, 247.5)
        self.assertAlmostEqual(scaled.protein_g, 46.5)

    def test_recipe_totals_are_normalized_by_servings(self) -> None:
        totals = recipe_per_serving(
            [
                MacroProfile(calories=200, protein_g=10),
                MacroProfile(calories=400, protein_g=30),
            ],
            servings=2,
        )
        self.assertAlmostEqual(totals.calories, 300)
        self.assertAlmostEqual(totals.protein_g, 20)

    def test_macro_aggregation_adds_each_item(self) -> None:
        result = aggregate_macros(
            [
                MacroProfile(calories=100, carbs_g=10),
                MacroProfile(calories=250, protein_g=20),
            ]
        )
        self.assertEqual(result.calories, 350)
        self.assertEqual(result.carbs_g, 10)
        self.assertEqual(result.protein_g, 20)


class ProgressionLogicTests(unittest.TestCase):
    def test_top_of_rep_range_adds_load(self) -> None:
        recommendation = recommend_progression(
            ProgressionContext(
                rep_target_min=6,
                rep_target_max=10,
                load_increment=2.5,
                recent_sets=[SetPerformance(reps=10, load_kg=100), SetPerformance(reps=10, load_kg=100)],
                calorie_adherence=0.95,
                weight_trend_kg_per_week=0.1,
            )
        )
        self.assertEqual(recommendation["recommendation"], "add_load")
        self.assertEqual(recommendation["next_load_kg"], 102.5)

    def test_low_recovery_and_low_reps_recommend_deload(self) -> None:
        recommendation = recommend_progression(
            ProgressionContext(
                rep_target_min=6,
                rep_target_max=10,
                load_increment=5,
                recent_sets=[SetPerformance(reps=4, load_kg=120), SetPerformance(reps=5, load_kg=120)],
                calorie_adherence=0.7,
                weight_trend_kg_per_week=-0.8,
            )
        )
        self.assertEqual(recommendation["recommendation"], "deload")
        self.assertEqual(recommendation["next_load_kg"], 115)

    def test_weight_trend_handles_smoothing(self) -> None:
        trend = weight_trend_per_week([80.0, 80.2, 80.5, 80.7, 81.0, 81.1, 81.3])
        self.assertGreater(trend, 0.5)


if __name__ == "__main__":
    unittest.main()
