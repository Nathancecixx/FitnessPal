# FitnessPal

Local-first fitness tracking software for nutrition, training, bodyweight, and AI-assisted meal logging.

## What is included

- `api/`: FastAPI backend with modular domain manifests, local auth, API keys, audit logs, idempotent write handling, JSON export/restore, and DB-backed background jobs.
- `web/`: React + TypeScript + Vite web app with a responsive dashboard, nutrition/training/bodyweight pages, insights, and OpenClaw-focused settings.
- `worker/`: Background processing service for meal-photo analysis, scheduled insight recomputation, and nightly JSON backups.
- `docker-compose.yml`: isolated `postgres`, `api`, `worker`, and `web` services for always-on local hosting.

## Core capabilities

- Detailed meal logging with manual macros, reusable foods, recipes, meal templates, and photo-analysis drafts.
- Strength/hypertrophy workout tracking with exercise defaults, templates, session logs, PR detection, and progressive overload recommendations.
- Weight tracking with 7-day and 30-day smoothing.
- Insight snapshots that connect calories, weight trend, training volume, and recovery flags.
- Machine-readable OpenClaw manifest at [http://localhost:8000/.well-known/fitnesspal-agent.json](http://localhost:8000/.well-known/fitnesspal-agent.json).

## Local auth defaults

- Username: `owner`
- Password: `fitnesspal`

Change those through environment variables before exposing the app beyond your local machine.

## Run with Docker

```bash
cp api/.env.example api/.env
cp web/.env.example web/.env
docker compose up --build
```

Services:

- Web UI: [http://localhost:8080](http://localhost:8080)
- API: [http://localhost:8000](http://localhost:8000)
- OpenAPI: [http://localhost:8000/api/v1/openapi.json](http://localhost:8000/api/v1/openapi.json)

## Run locally without Docker

Backend:

```bash
cd api
python -m venv .venv
.venv\Scripts\activate
pip install -e .
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Worker:

```bash
cd api
.venv\Scripts\activate
python -m app.worker
```

Frontend:

```bash
cd web
npm install
npm run dev
```

## OpenClaw integration

- Use the Settings page to issue a full-control API key.
- Point the agent at the `/.well-known/fitnesspal-agent.json` manifest.
- All writes support `Idempotency-Key` headers so your agent can safely retry requests.

## Local AI meal photos

Set `FITNESSPAL_LOCAL_AI_BASE_URL` to an OpenAI-compatible local vision endpoint if you want image analysis. If it is unset, FitnessPal still creates meal-photo drafts using a filename heuristic fallback so the workflow stays usable offline.

## Verification performed in this workspace

- `python -m compileall api/app api/tests`
- `python -m unittest discover -s api/tests`

Frontend dependencies are not installed in this workspace yet, so the React app was not type-checked here.
