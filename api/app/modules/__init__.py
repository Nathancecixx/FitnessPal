from app.modules.calendar import manifest as calendar_manifest
from app.modules.ai import manifest as ai_manifest
from app.modules.insights import manifest as insights_manifest
from app.modules.metrics import manifest as metrics_manifest
from app.modules.nutrition import manifest as nutrition_manifest
from app.modules.platform import manifest as platform_manifest
from app.modules.training import manifest as training_manifest


def load_manifests():
    return [
        platform_manifest,
        ai_manifest,
        calendar_manifest,
        nutrition_manifest,
        training_manifest,
        metrics_manifest,
        insights_manifest,
    ]
