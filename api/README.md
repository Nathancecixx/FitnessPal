# FitnessPal API

The `api/` package contains the FastAPI backend for FitnessPal.

It owns:

- authentication
- authorization primitives
- database access
- modular domain routing
- dashboard aggregation
- local AI integration
- exports and restore
- background job definitions
- agent-facing manifests and examples

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Directory Layout](#directory-layout)
- [Application Lifecycle](#application-lifecycle)
- [Module System](#module-system)
- [HTTP Surface](#http-surface)
- [Authentication](#authentication)
- [Jobs and Background Work](#jobs-and-background-work)
- [Configuration](#configuration)
- [Running the API](#running-the-api)
- [Testing](#testing)
- [Current Caveats](#current-caveats)

## Overview

The backend is built as a modular monolith.

Each domain registers a `ModuleManifest` that can contribute:

- a FastAPI router
- dashboard card definitions
- a dashboard loader
- agent examples
- job handlers

Current loaded manifests:

- `platform`
- `nutrition`
- `training`
- `metrics`
- `insights`

The backend publishes all route groups under `/api/v1`.

It also serves:

- root metadata at `/`
- OpenAPI at `/api/v1/openapi.json`
- FitnessPal agent manifest at `/.well-known/fitnesspal-agent.json`

## Tech Stack

- FastAPI
- SQLAlchemy 2.x
- Psycopg 3
- Pydantic
- Uvicorn
- Python `httpx` for local AI requests

## Directory Layout

```text
api/
|- app/
|  |- core/
|  |  |- audit.py
|  |  |- config.py
|  |  |- database.py
|  |  |- idempotency.py
|  |  |- jobs.py
|  |  |- local_ai.py
|  |  |- logic.py
|  |  |- models.py
|  |  |- modules.py
|  |  |- schemas.py
|  |  |- security.py
|  |  |- serialization.py
|  |  `- storage.py
|  |- modules/
|  |  |- insights.py
|  |  |- metrics.py
|  |  |- nutrition.py
|  |  |- platform.py
|  |  `- training.py
|  |- main.py
|  `- worker.py
|- tests/
|  `- test_logic.py
|- Dockerfile
|- pyproject.toml
`- README.md
```

## Application Lifecycle

On startup, the FastAPI lifespan in `app/main.py` performs the following:

1. ensures storage directories exist
2. initializes the database schema
3. ensures the bootstrap user exists
4. loads all module manifests
5. mounts module routers under the configured API prefix

The default database initialization path is:

```python
Base.metadata.create_all(bind=engine)
```

That makes local setup easy, but it also means schema evolution is not migration-managed yet.

## Module System

The module system lives in `app/core/modules.py`.

`ModuleManifest` currently supports:

- `key`
- `router`
- `dashboard_cards`
- `dashboard_loader`
- `agent_examples`
- `job_handlers`

This keeps the backend extensible without scattering domain registration logic across the app entrypoint.

## HTTP Surface

### Platform routes

- `GET /health`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /metrics`
- `GET /runtime`
- `GET /jobs`
- `GET /goals`
- `POST /goals`
- `DELETE /goals/{goal_id}`
- `GET /api-keys`
- `POST /api-keys`
- `DELETE /api-keys/{key_id}`
- `GET /exports`
- `POST /exports`
- `GET /exports/{export_id}/download`
- `POST /exports/restore`

### Nutrition routes

- `GET /foods`
- `POST /foods`
- `GET /foods/{food_id}`
- `GET /recipes`
- `POST /recipes`
- `GET /recipes/{recipe_id}`
- `GET /meal-templates`
- `POST /meal-templates`
- `GET /meal-templates/{template_id}`
- `GET /meals`
- `POST /meals`
- `GET /meals/{meal_id}`
- `DELETE /meals/{meal_id}`
- `GET /meal-photos`
- `POST /meal-photos`
- `POST /meal-photos/{draft_id}/analyze`
- `GET /meal-photos/{draft_id}`
- `POST /meal-photos/{draft_id}/confirm`

### Training routes

- `GET /exercises`
- `POST /exercises`
- `GET /exercises/{exercise_id}`
- `GET /exercises/{exercise_id}/progression`
- `GET /routines`
- `POST /routines`
- `GET /workout-templates`
- `POST /workout-templates`
- `GET /workout-templates/{template_id}`
- `GET /workout-sessions`
- `POST /workout-sessions`
- `GET /workout-sessions/{session_id}`
- `DELETE /workout-sessions/{session_id}`

### Metrics routes

- `GET /weight-entries`
- `POST /weight-entries`
- `GET /weight-entries/trends`
- `DELETE /weight-entries/{entry_id}`

### Insights routes

- `GET /insights`
- `POST /insights/recompute`

### Aggregate and manifest routes

- `GET /api/v1/dashboard`
- `GET /api/v1/openapi.json`
- `GET /.well-known/fitnesspal-agent.json`

## Authentication

The backend supports two actor types.

### Session-cookie auth

Used by the web app.

- login endpoint: `POST /api/v1/auth/login`
- cookie name: `fitnesspal_session`
- logout endpoint: `POST /api/v1/auth/logout`

### Bearer API key auth

Used by OpenClaw and other local agents.

- create keys with `POST /api/v1/api-keys`
- pass `Authorization: Bearer <token>`

### Bootstrap user

If no user exists yet, the backend creates one automatically from:

- `FITNESSPAL_BOOTSTRAP_USERNAME`
- `FITNESSPAL_BOOTSTRAP_PASSWORD`

### Password and token handling

- passwords are stored using `hashlib.scrypt`
- session tokens and API keys are stored as SHA-256 hashes
- revoked tokens are retained for auditability

### Idempotency

Routers use the custom `IdempotentRoute` class.

Agent and automation clients should send `Idempotency-Key` on non-idempotent writes to make retries safer.

## Jobs and Background Work

Job state is stored in the database.

The worker process:

1. ensures scheduled daily jobs exist
2. claims one queued job with row locking
3. runs the handler registered by module manifests
4. marks the job completed or failed
5. retries failed jobs with backoff until max attempts are reached

Current built-in scheduled jobs:

- nightly `insights.recompute`
- nightly `platform.backup`

Current job handlers:

- `nutrition.analyze_photo`
- `insights.recompute`
- `platform.backup`

## Configuration

Environment variables supported by the backend:

| Variable | Purpose | Default |
| --- | --- | --- |
| `FITNESSPAL_APP_NAME` | displayed app name | `FitnessPal` |
| `FITNESSPAL_API_PREFIX` | API prefix | `/api/v1` |
| `FITNESSPAL_DATABASE_URL` | SQLAlchemy database URL | `postgresql+psycopg://fitnesspal:fitnesspal@postgres:5432/fitnesspal` |
| `FITNESSPAL_SQL_ECHO` | SQL echo logging | `false` |
| `FITNESSPAL_BOOTSTRAP_USERNAME` | initial username | `owner` |
| `FITNESSPAL_BOOTSTRAP_PASSWORD` | initial password | `fitnesspal` |
| `FITNESSPAL_SESSION_DAYS` | session duration | `30` |
| `FITNESSPAL_STORAGE_ROOT` | local storage root | `storage` |
| `FITNESSPAL_ALLOW_ORIGINS` | CORS allow-list | `http://localhost:5173,http://127.0.0.1:5173` plus deployment overrides |
| `FITNESSPAL_LOCAL_AI_BASE_URL` | local AI endpoint | unset unless configured |
| `FITNESSPAL_LOCAL_AI_MODEL` | local AI model name | `qwen3-vl:8b` |
| `FITNESSPAL_LOCAL_AI_TIMEOUT_SECONDS` | AI timeout | `60` in app defaults, `90` in Docker env examples |
| `FITNESSPAL_AGENT_MANIFEST_URL` | full agent manifest URL | `http://localhost:8080/.well-known/fitnesspal-agent.json` |

Notes:

- in Docker, storage is mounted to `/srv/storage`
- in local development, storage defaults to a repo-local `storage/` directory unless overridden

## Running the API

### Local development

```bash
python -m venv .venv
```

Activate the environment and install dependencies:

```bash
pip install -e .[dev]
```

Run the API:

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run the worker in another shell:

```bash
python -m app.worker
```

### Docker

From the repository root:

```bash
docker compose up --build -d api worker postgres
```

## Testing

Current automated checks:

```bash
python -m compileall app tests
python -m unittest discover -s tests
```

Current test coverage focuses on core nutrition math and progression logic.

## Current Caveats

- schema evolution is not migration-managed yet
- API key scopes are stored but not comprehensively enforced at route boundaries yet
- route coverage in automated tests is still limited
- this backend is designed for a trusted local environment, not an untrusted internet-facing multi-user deployment
