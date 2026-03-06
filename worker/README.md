# FitnessPal Worker

The `worker/` directory is documentation-only.

The actual worker runtime lives in:

- `api/app/worker.py`

The Docker worker service reuses the backend image and runs:

```bash
python -m app.worker
```

## Table of Contents

- [Overview](#overview)
- [What the Worker Does](#what-the-worker-does)
- [What the Worker Is Not](#what-the-worker-is-not)
- [Execution Model](#execution-model)
- [Current Job Handlers](#current-job-handlers)
- [Scheduling and Retries](#scheduling-and-retries)
- [Running the Worker](#running-the-worker)
- [Observability](#observability)
- [Extending the Worker](#extending-the-worker)
- [Current Caveats](#current-caveats)

## Overview

The worker is a simple database-backed background processor for asynchronous and scheduled tasks.

It exists so the API can stay responsive while still supporting:

- meal photo analysis
- nightly insight recomputation
- nightly local backups

## What the Worker Does

The worker loop:

1. ensures daily scheduled jobs exist
2. claims the next available queued job
3. resolves the handler registered for the job type
4. executes the handler inside a database session
5. marks the job as completed or failed
6. retries failed jobs with backoff until `max_attempts` is reached

## What the Worker Is Not

The worker is not:

- a separate orchestration product
- a distributed queue system
- a general-purpose workflow engine

Local scripts and clients should interact with FitnessPal through the API, not by replacing or embedding the worker.

## Execution Model

The worker is intentionally simple.

Key implementation details:

- jobs are stored in PostgreSQL
- claiming uses row locking with `FOR UPDATE SKIP LOCKED`
- retries requeue the job with a delayed `available_at`
- the loop sleeps when no work is available
- SQLAlchemy session scopes are opened per worker operation

Core implementation files:

- `api/app/worker.py`
- `api/app/core/jobs.py`
- `api/app/core/modules.py`

## Current Job Handlers

Registered today:

- `nutrition.analyze_photo`
  - analyzes an uploaded meal photo
  - talks to the configured AI backend for that feature
  - stores candidate meal items and confidence metadata in a draft
- `insights.recompute`
  - refreshes the latest insight snapshot
  - powers dashboard metrics and coach-brief generation
- `platform.backup`
  - creates a JSON export
  - stores the export under local storage and records it in the database

## Scheduling and Retries

The worker ensures daily jobs exist via `ensure_daily_jobs()`:

- `insights.recompute` scheduled for 03:00 UTC
- `platform.backup` scheduled for 03:05 UTC

Retry behavior:

- jobs are retried until `max_attempts` is reached
- the retry delay grows with attempt count
- once attempts are exhausted, the job is marked `failed`

## Running the Worker

### Local development

From `api/`:

```bash
python -m app.worker
```

### Docker

From the repository root:

```bash
docker compose up --build -d worker
```

### Full stack

```bash
docker compose up --build -d
```

## Observability

Current visibility options:

- Settings page in the web app
- `GET /api/v1/jobs`
- `GET /api/v1/runtime`
- Docker logs

Useful commands:

```bash
docker compose logs -f worker
docker compose logs -f api
```

## Extending the Worker

To add a new job type:

1. implement the job behavior in the relevant backend module
2. register the handler in that module's `ModuleManifest`
3. enqueue the job from the API or from another handler
4. expose job state in the UI if needed
5. add tests for the related logic

This keeps background behavior aligned with the same modular structure used for HTTP routes and dashboard cards.

## Current Caveats

- single-process worker loop only
- no dedicated metrics backend yet
- no separate dead-letter queue
- no horizontal scaling story documented yet
- background processing is reliable enough for local operation, but not yet shaped like a large-scale distributed worker platform
