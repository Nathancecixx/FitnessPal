# FitnessPal Worker

The deployed worker code lives in [api/app/worker.py](C:/Users/natha/OneDrive/Documents/Projects/FitnessPal/api/app/worker.py).

The `worker/` folder is documentation-only. The running worker container reuses the API image and executes:

```bash
python -m app.worker
```

Current job handlers:

- `nutrition.analyze_photo`
- `insights.recompute`
- `platform.backup`
