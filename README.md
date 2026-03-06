# FitnessPal

Local-first fitness tracking software for nutrition, training, bodyweight, and agent-driven workflows.

## Stack

- `api/`: FastAPI backend with modular domain manifests, local auth, API keys, audit logs, idempotent writes, export/restore, and a DB-backed job queue.
- `web/`: React + TypeScript + Vite frontend with dashboards for nutrition, training, bodyweight, insights, templates, and settings.
- `worker/`: Background processing runs from `api/app/worker.py` and handles photo analysis, insight recomputation, and scheduled backups.
- `docker-compose.yml`: isolated `postgres`, `api`, `worker`, and `web` services for always-on local hosting.

## What works now

- Detailed meal logging with quick macros, saved foods, ingredient-based recipes, meal templates, and photo-analysis drafts.
- Strength and hypertrophy logging with exercises, workout templates, set-by-set sessions, PR detection, and progression recommendations.
- Weight tracking with 7-day and 30-day smoothing.
- Insight snapshots that connect calories, weight trend, training volume, and recovery flags.
- OpenClaw-friendly API manifest at `/.well-known/fitnesspal-agent.json`.
- Worker/runtime visibility from the Settings page, including local AI config and recent background jobs.

## Local defaults

- Username: `owner`
- Password: `fitnesspal`

Change these before exposing the stack beyond your trusted local network.

## Ollama and OpenClaw

FitnessPal uses an OpenAI-compatible local vision endpoint for meal photo analysis. The default deployment is configured for:

- `FITNESSPAL_LOCAL_AI_BASE_URL=http://host.docker.internal:11434/v1`
- `FITNESSPAL_LOCAL_AI_MODEL=qwen3-vl:8b`

If your Ollama host, path, or model tag differs, override those values in a local `.env` file. If Ollama is on another LAN machine, replace `host.docker.internal` with that reachable host.

For OpenClaw:

- create an API key from the Settings page
- point OpenClaw at `http://localhost:8080/.well-known/fitnesspal-agent.json`
- send writes with `Idempotency-Key` headers so retries stay safe

## Run with Docker

```bash
copy .env.example .env
docker compose up --build -d
```

Services:

- Web UI: [http://localhost:8080](http://localhost:8080)
- API: [http://localhost:8000](http://localhost:8000)
- Health: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- Agent manifest: [http://localhost:8080/.well-known/fitnesspal-agent.json](http://localhost:8080/.well-known/fitnesspal-agent.json)

The web container proxies `/api/*` and `/.well-known/*` to the backend, so the browser can run against one origin.

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

## Production-testing notes

- The current release is single-user and local-first.
- Schema setup still uses SQLAlchemy `create_all`, so this is production-testable for a fresh local deployment but not yet a migration-managed multi-upgrade system.
- API key scopes are stored and exposed, but the default intended workflow is still full-control local keys for trusted agents.

## Verification

- `python -m compileall api/app api/tests`
- `python -m unittest discover -s api/tests`
- `npm run build`
- `docker compose up --build -d`
