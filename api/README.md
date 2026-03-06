# FitnessPal API

The `api/` package contains the FastAPI backend for FitnessPal.

It owns:

- authentication
- authorization primitives
- database access
- modular domain routing
- dashboard aggregation
- admin-managed AI integration and coach briefs
- exports and restore
- background job definitions
- assistant-facing routes and background flows

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
- job handlers

Current loaded manifests:

- `platform`
- `ai`
- `nutrition`
- `training`
- `metrics`
- `insights`

The backend publishes all route groups under `/api/v1`.

It also serves:

- root metadata at `/`
- OpenAPI at `/api/v1/openapi.json`

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
|- migrations/
|- alembic.ini
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
3. ensures the configured admin user exists
4. loads all module manifests
5. mounts module routers under the configured API prefix

The default database initialization path now runs an Alembic-backed schema check:

```python
ensure_schema_current()
```

On startup the app will:

- upgrade an empty database to the latest revision
- stamp an existing pre-migration schema at `head`
- apply any outstanding Alembic migrations

## Module System

The module system lives in `app/core/modules.py`.

`ModuleManifest` currently supports:

- `key`
- `router`
- `dashboard_cards`
- `dashboard_loader`
- `job_handlers`

This keeps the backend extensible without scattering domain registration logic across the app entrypoint.

## HTTP Surface

### Platform routes

- `GET /health`
- `POST /auth/login`
- `POST /auth/password/setup`
- `POST /auth/password/change`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /users`
- `POST /users`
- `POST /users/{user_id}/password-setup`
- `GET /metrics`
- `GET /runtime`
- `GET /jobs`
- `GET /assistant/brief`
- `POST /assistant/brief/refresh`
- `GET /goals`
- `POST /goals`
- `DELETE /goals/{goal_id}`
- `GET /api-keys`
- `POST /api-keys`
- `DELETE /api-keys/{key_id}`
- `POST /assistant/parse`
- `GET /exports`
- `POST /exports`
- `GET /exports/{export_id}/download`
- `POST /exports/restore`

### AI routes

- `GET /ai/profiles`
- `POST /ai/profiles`
- `GET /ai/profiles/{profile_id}`
- `PATCH /ai/profiles/{profile_id}`
- `DELETE /ai/profiles/{profile_id}`
- `POST /ai/profiles/{profile_id}/test`
- `POST /ai/profiles/{profile_id}/models/refresh`
- `GET /ai/features`
- `PUT /ai/features`
- `GET /ai/persona`
- `PUT /ai/persona`

### Nutrition routes

- `GET /foods`
- `POST /foods`
- `GET /foods/{food_id}`
- `GET /foods/barcode-lookup/{barcode}`
- `POST /foods/label-photo`
- `GET /recipes`
- `POST /recipes`
- `GET /recipes/{recipe_id}`
- `GET /meal-templates`
- `POST /meal-templates`
- `GET /meal-templates/{template_id}`
- `GET /meals`
- `POST /meals`
- `GET /meals/{meal_id}`
- `PATCH /meals/{meal_id}`
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
- `PATCH /workout-sessions/{session_id}`
- `DELETE /workout-sessions/{session_id}`

### Metrics routes

- `GET /weight-entries`
- `POST /weight-entries`
- `GET /weight-entries/trends`
- `PATCH /weight-entries/{entry_id}`
- `DELETE /weight-entries/{entry_id}`

### Insights routes

- `GET /insights`
- `POST /insights/recompute`

### Aggregate routes

- `GET /api/v1/dashboard`
- `GET /api/v1/openapi.json`

## Authentication

The backend supports two actor types.

### Session-cookie auth

Used by the web app.

- login endpoint: `POST /api/v1/auth/login`
- cookie name: `fitnesspal_session`
- logout endpoint: `POST /api/v1/auth/logout`

### Bearer API key auth

Used by trusted local scripts, private clients, and automation.

- create keys with `POST /api/v1/api-keys`
- pass `Authorization: Bearer <token>`
- use scoped keys such as `nutrition:*`, `training:write`, or `assistant:use`

Scope matching supports:

- exact scopes such as `metrics:read`
- namespace wildcards such as `nutrition:*`
- full control with `*`

### Admin bootstrap and managed users

On startup the backend ensures the configured admin exists using:

- `FITNESSPAL_ADMIN_USERNAME`
- `FITNESSPAL_ADMIN_PASSWORD`

Admins can create additional users through the API. New users receive one-time password setup tokens and set their own passwords before first login.

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
| `FITNESSPAL_ADMIN_USERNAME` | bootstrap admin username | `owner` |
| `FITNESSPAL_ADMIN_PASSWORD` | bootstrap admin password | `fitnesspal` |
| `FITNESSPAL_PASSWORD_SETUP_HOURS` | one-time password setup token lifetime | `72` |
| `FITNESSPAL_SESSION_DAYS` | session duration | `30` |
| `FITNESSPAL_STORAGE_ROOT` | local storage root | `storage` |
| `FITNESSPAL_ALLOW_ORIGINS` | CORS allow-list | `http://localhost:5173,http://127.0.0.1:5173` plus deployment overrides |
| `FITNESSPAL_CONFIG_SECRET` | encryption key for stored AI provider secrets | unset |
| `FITNESSPAL_LOCAL_AI_BASE_URL` | legacy read-only AI fallback endpoint | unset unless configured |
| `FITNESSPAL_LOCAL_AI_MODEL` | legacy fallback model name | `qwen3-vl:8b` |
| `FITNESSPAL_LOCAL_AI_TIMEOUT_SECONDS` | legacy fallback timeout | `60` in app defaults, `90` in Docker env examples |
| `FITNESSPAL_BARCODE_LOOKUP_BASE_URL` | barcode lookup base URL | `https://world.openfoodfacts.org` |
| `FITNESSPAL_BARCODE_LOOKUP_TIMEOUT_SECONDS` | barcode lookup timeout | `10` |
| `FITNESSPAL_BARCODE_LOOKUP_USER_AGENT` | outbound barcode lookup user-agent | `FitnessPal/0.1.0` |

Notes:

- in Docker, storage is mounted to `/srv/storage`
- in local development, storage defaults to a repo-local `storage/` directory unless overridden
- no saved AI provider secret can be written until `FITNESSPAL_CONFIG_SECRET` is present

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
python -m alembic upgrade head
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

Current test coverage includes core nutrition math, progression logic, transaction boundaries, scope matching, edit flows, and restore rollback behavior.

## Current Caveats

- route coverage is still limited compared with the full API surface
- AI parsing, coach briefs, and OCR workflows are intentionally review-first
- this backend is designed for trusted local or LAN users, not an untrusted internet-facing self-signup deployment
