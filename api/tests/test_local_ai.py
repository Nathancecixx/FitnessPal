from __future__ import annotations

import unittest

from app.core.local_ai import _heuristic_text_drafts


class LocalAiHeuristicTests(unittest.TestCase):
    def test_weight_draft_accepts_pounds_and_converts_to_kg(self) -> None:
        result = _heuristic_text_drafts("Weighed 181.7 lbs this morning at 15% bf")

        self.assertEqual(result["drafts"][0]["kind"], "weight_entry")
        self.assertEqual(result["drafts"][0]["summary"], "Log weigh-in at 181.7 lbs")
        self.assertAlmostEqual(result["drafts"][0]["payload"]["weight_kg"], 82.418, places=3)
        self.assertEqual(result["drafts"][0]["payload"]["body_fat_pct"], 15.0)

    def test_workout_draft_accepts_pounds_and_converts_load_to_kg(self) -> None:
        result = _heuristic_text_drafts("bench press 3x5 @ 225 lb")

        self.assertEqual(result["drafts"][0]["kind"], "workout_session")
        self.assertAlmostEqual(result["drafts"][0]["payload"]["sets"][0]["load_kg"], 102.058, places=3)


if __name__ == "__main__":
    unittest.main()
