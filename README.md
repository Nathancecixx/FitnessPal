# FitnessPal

FitnessPal is a local-first fitness tracking platform for nutrition, training, bodyweight, and agent-assisted workflows.

It is designed for a small number of trusted users on a local machine or LAN deployment, with all structured data, uploaded meal photos, exports, and AI integrations kept under local control.

## Table of Contents

- [Overview](#overview)
- [Current Status](#current-status)
- [Feature Summary](#feature-summary)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Quick Start](#quick-start)
- [Local AI and Ollama](#local-ai-and-ollama)
- [OpenClaw Integration](#openclaw-integration)
- [Development](#development)
- [Configuration](#configuration)
- [Operations](#operations)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [Roadmap Ideas](#roadmap-ideas)
- [License](#license)

## Overview

FitnessPal combines:

- a FastAPI backend with a modular domain layout
- a React web app optimized for fast day-to-day phone use
- a lightweight worker loop for background jobs
- PostgreSQL for local structured storage
- local disk storage for uploads and exports
- optional local AI integration for meal photo analysis

The project is intentionally local-first:

- no cloud auth is required
- no cloud storage is required
- no third-party nutrition API is required
- OpenClaw and local LLM tooling interact through the same documented API surface used by the web app

## Current Status

FitnessPal is usable today for local production-style testing.

Implemented now:

- nutrition logging with foods, recipes, meal templates, manual macro logging, barcode lookup, nutrition-label photo drafts, and meal photo draft analysis
- training logging with exercises, workout templates, routines, sessions, set-level logging, PR detection, progression recommendations, and session editing
- weight tracking with rolling 7-day and 30-day trends plus edit/delete correction flows
- insight snapshots that connect calories, bodyweight, training volume, and recovery flags
- local multi-user auth, scoped API keys, audit logging, per-user export/restore, runtime inspection, and a background job queue
- assistant quick capture for reviewable natural-language drafts before write actions
- versioned Alembic migrations with startup schema checks for safer upgrades
- a mobile-first web app with lazy-loaded routes and installable PWA basics

Not fully mature yet:

- automated coverage is still mostly backend unit and transaction tests rather than end-to-end browser coverage
- AI parsing and label/photo extraction stay review-first and depend heavily on the configured local model
- barcode import quality depends on external OpenFoodFacts coverage for the scanned product

## Feature Summary

### Nutrition

- create foods with macro data
- import foods from barcode lookup and nutrition-label photos
- build recipes from saved foods and gram amounts
- build reusable meal templates
- log meals manually with calories, protein, carbs, and fat
- upload meal photos for AI-assisted draft generation
- edit and delete logged meals after review
- review and confirm AI-generated drafts before they become saved meals

### Training

- create exercises with progression defaults
- define workout templates and routines
- log workout sessions with set-by-set details
- edit, repeat, and delete logged workout sessions
- mark PRs automatically based on performance
- generate progression recommendations using recent sets and bodyweight/calorie context

### Body Metrics

- log weight entries
- optionally include body fat percentage, waist, and notes
- edit and delete check-ins without leaving the main flow
- calculate rolling 7-day and 30-day trend lines
- expose weight trend per week for use in dashboard and coaching logic

### Platform and Agent Workflows

- local session-cookie auth for the web app
- bearer API keys for OpenClaw and other trusted local agents, with route scopes and namespace wildcards
- machine-readable agent manifest at `/.well-known/fitnesspal-agent.json`
- natural-language draft parsing at `POST /api/v1/assistant/parse`
- export and restore flows for local backups
- background job inspection from the UI
- runtime inspection including local AI connectivity and model availability

## Architecture

```mermaid
flowchart LR
    Browser["Browser / Phone"] --> Web["web (Nginx + React)"]
    Web --> API["api (FastAPI)"]
    API --> DB["PostgreSQL"]
    API --> Storage["Local storage volume"]
    Worker["worker (python -m app.worker)"] --> DB
    Worker --> Storage
    Worker --> AI["Local AI / Ollama / OpenAI-compatible endpoint"]
    OpenClaw["OpenClaw agent"] --> API
```

### Runtime Components

- `web`
  - serves the React application
  - proxies `/api/*` and `/.well-known/*` to the backend so the browser can stay on one origin
- `api`
  - exposes `/api/v1/*`
  - serves the OpenAPI document
  - serves the FitnessPal agent manifest
  - owns auth, persistence, domain logic, and exports
- `worker`
  - runs the background loop from `api/app/worker.py`
  - claims queued jobs from the database and executes registered handlers
- `postgres`
  - persists application data
- `storage/`
  - stores uploaded meal photos and generated exports on local disk

## Repository Layout

```text
FitnessPal/
|- api/                 FastAPI backend package and tests
|- infra/               Extra infrastructure config
|  `- nginx/            Example reverse proxy config
|- storage/             Local uploads and exports
|- web/                 React frontend
|- worker/              Worker documentation
|- docker-compose.yml   Local multi-service deployment
`- README.md            Repository overview and operator guide
```

Additional package-level documentation:

- [`api/README.md`](api/README.md)
- [`web/README.md`](web/README.md)
- [`worker/README.md`](worker/README.md)

## Quick Start

### Prerequisites

- Docker Desktop with Compose support
- optionally, a local Ollama or OpenAI-compatible inference endpoint for meal photo analysis

### 1. Create a local environment file

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

### 2. Start the stack

```bash
docker compose up --build -d
```

### 3. Open the app

- Web UI: [http://localhost:8080](http://localhost:8080)
- API root: [http://localhost:8000](http://localhost:8000)
- Health: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- OpenAPI: [http://localhost:8000/api/v1/openapi.json](http://localhost:8000/api/v1/openapi.json)
- Agent manifest: [http://localhost:8080/.well-known/fitnesspal-agent.json](http://localhost:8080/.well-known/fitnesspal-agent.json)

### 4. Sign in

Bootstrap admin credentials come from:

- `FITNESSPAL_ADMIN_USERNAME`
- `FITNESSPAL_ADMIN_PASSWORD`

After the admin signs in, additional users can be created from Settings. Each created user receives a one-time password setup link and only sees their own data.

## Local AI and Ollama

FitnessPal treats meal photo analysis as an optional local service integration.

Expected interface:

- OpenAI-compatible `chat/completions`
- image-capable model
- reachable from the `api` and `worker` containers

Default environment values:

- `FITNESSPAL_LOCAL_AI_BASE_URL=http://host.docker.internal:11434/v1`
- `FITNESSPAL_LOCAL_AI_MODEL=qwen3-vl:8b`

### Recommended Ollama setup

1. Install or run Ollama on the same machine, or expose it on your LAN.
2. Pull a vision-capable model.
3. Point FitnessPal at the Ollama OpenAI-compatible endpoint.

Example:

```bash
ollama pull qwen3-vl:8b
```

If Ollama runs on another machine, update `.env`:

```env
FITNESSPAL_LOCAL_AI_BASE_URL=http://192.168.40.94:11434/v1
FITNESSPAL_LOCAL_AI_MODEL=qwen3-vl:8b
```

If the model is unavailable or the endpoint is unreachable, the meal-photo flow falls back to a safe draft/review workflow instead of silently committing guessed meals.

## OpenClaw Integration

FitnessPal is designed to be agent-friendly.

### Agent entry points

- manifest: `/.well-known/fitnesspal-agent.json`
- OpenAPI schema: `/api/v1/openapi.json`
- login endpoint: `/api/v1/auth/login`
- API key issuance: `/api/v1/api-keys`

### Recommended OpenClaw workflow

1. Open the web app.
2. Go to Settings.
3. Generate an API key for OpenClaw.
4. Point OpenClaw at the agent manifest URL.
5. Use `Idempotency-Key` headers for write requests so retries remain safe.
6. Prefer narrowly scoped API keys such as `nutrition:*` or `assistant:use,metrics:write` instead of full-control tokens.

### Agent-facing resource groups

- `/foods`
- `/recipes`
- `/meal-templates`
- `/meals`
- `/meal-photos`
- `/assistant/parse`
- `/exercises`
- `/routines`
- `/workout-templates`
- `/workout-sessions`
- `/weight-entries`
- `/goals`
- `/insights`
- `/jobs`
- `/exports`
- `/api-keys`

## Development

### Backend

```bash
cd api
python -m venv .venv
```

Activate the virtual environment.

On Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

On macOS or Linux:

```bash
source .venv/bin/activate
```

Install dependencies and run the API:

```bash
pip install -e .[dev]
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Worker

Run the worker in a second shell:

```bash
cd api
python -m app.worker
```

### Frontend

```bash
cd web
npm install
npm run dev
```

### Frontend and backend together without Docker

- run PostgreSQL locally
- set `FITNESSPAL_DATABASE_URL`
- start the API
- start the worker
- start the Vite dev server

The default frontend dev origin is `http://localhost:5173`, which is already included in the default CORS settings.

## Configuration

The root `.env.example` is the easiest starting point for Docker-based development.

| Variable | Purpose | Default |
| --- | --- | --- |
| `FITNESSPAL_DATABASE_URL` | SQLAlchemy database URL | `postgresql+psycopg://fitnesspal:fitnesspal@postgres:5432/fitnesspal` |
| `FITNESSPAL_ADMIN_USERNAME` | bootstrap admin username | `owner` |
| `FITNESSPAL_ADMIN_PASSWORD` | bootstrap admin password | `fitnesspal` |
| `FITNESSPAL_PASSWORD_SETUP_HOURS` | one-time password setup link lifetime | `72` |
| `FITNESSPAL_ALLOW_ORIGINS` | CORS allow-list | `http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080` |
| `FITNESSPAL_AGENT_MANIFEST_URL` | public manifest URL | `http://localhost:8080/.well-known/fitnesspal-agent.json` |
| `FITNESSPAL_LOCAL_AI_BASE_URL` | local AI endpoint | `http://host.docker.internal:11434/v1` |
| `FITNESSPAL_LOCAL_AI_MODEL` | image-capable model name | `qwen3-vl:8b` |
| `FITNESSPAL_LOCAL_AI_TIMEOUT_SECONDS` | AI request timeout | `90` |
| `FITNESSPAL_BARCODE_LOOKUP_BASE_URL` | barcode product lookup base URL | `https://world.openfoodfacts.org` |
| `FITNESSPAL_BARCODE_LOOKUP_TIMEOUT_SECONDS` | barcode lookup timeout | `10` |
| `FITNESSPAL_BARCODE_LOOKUP_USER_AGENT` | outbound barcode lookup user-agent | `FitnessPal/0.1.0` |

Backend-only environment details are documented in [`api/README.md`](api/README.md).

Frontend-only environment details are documented in [`web/README.md`](web/README.md).

## Operations

### Health and runtime inspection

- health: `GET /api/v1/health`
- runtime info: `GET /api/v1/runtime`
- job queue: `GET /api/v1/jobs`

### Exports and restore

FitnessPal stores JSON exports under `storage/exports/`.

Available workflows:

- create exports from the Settings page
- create exports with `POST /api/v1/exports`
- download exports with `GET /api/v1/exports/{id}/download`
- restore exports with `POST /api/v1/exports/restore`

### Migrations

- app startup automatically stamps legacy databases and upgrades to the latest Alembic revision
- manual upgrade path: `cd api && python -m alembic upgrade head`

### Storage locations

- uploaded meal photos: `storage/uploads/meal-photos/`
- generated exports: `storage/exports/`

### Logs

Container logs:

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

### Stop the stack

```bash
docker compose down
```

## Testing

Backend checks:

```bash
cd api
python -m compileall app tests
python -m unittest discover -s tests
```

Frontend checks:

```bash
cd web
npm run build
```

Full local stack check:

```bash
docker compose up --build -d
docker compose ps
```

## Known Limitations

- local-first by design, not a hosted multi-tenant SaaS
- intended for trusted local or LAN users rather than untrusted internet-facing self-signup
- end-to-end browser coverage is still missing
- assistant parsing remains a review-and-apply workflow rather than a fully conversational coach loop
- tests do not yet cover the full integration surface
- meal photo analysis quality depends entirely on the configured local vision model
- barcode imports are only as complete as the upstream product database

## Roadmap Ideas

- end-to-end browser tests
- progress photo support
- richer workout analytics and history views
- generated typed frontend client from OpenAPI
- richer assistant review/apply flows with user-facing confirmations and batching
- offline-first sync and background retry for mobile logging

## License

This repository is licensed under the terms of the [LICENSE](LICENSE) file.
