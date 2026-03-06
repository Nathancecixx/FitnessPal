# FitnessPal Worker

The worker service runs `python -m app.worker` from the API image and processes background jobs such as:

- photo meal analysis
- insight recomputation
- nightly JSON backups
