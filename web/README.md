# FitnessPal Web

The `web/` package contains the FitnessPal frontend.

It is a React single-page app optimized for:

- fast day-to-day mobile use
- quick logging flows
- local-first deployment behind the bundled Nginx proxy
- a single origin experience where the browser can talk to the API without separate frontend CORS setup in production

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Routing and Screens](#routing-and-screens)
- [UI Principles](#ui-principles)
- [Frontend Architecture](#frontend-architecture)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Build and Deploy](#build-and-deploy)
- [Current Caveats](#current-caveats)

## Overview

The frontend focuses on practical tracking:

- quick dashboard actions
- manual meal logging
- meal photo upload and draft review
- fast workout logging
- weight check-ins
- template reuse
- runtime and agent settings

The app is intentionally mobile-first, but still works well on larger screens.

## Tech Stack

- React 18
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Tailwind CSS
- Apache ECharts via `echarts-for-react`

## Routing and Screens

Defined in `src/router.tsx`.

Routes:

- `/` - dashboard and quick actions
- `/nutrition` - food logging, photo logging, repeat meals, recipe tools
- `/training` - workout logging, progression view, template shortcuts
- `/weight` - weigh-ins and bodyweight trends
- `/templates` - meal and workout template management
- `/insights` - coaching signals and snapshots
- `/settings` - runtime inspection, exports, jobs, goals, and API keys

## UI Principles

The current UI direction is:

- mobile-first navigation
- large tap targets
- quick daily flows first
- advanced builders behind expandable sections
- persistent theme selection with a light/dark toggle
- single-user local product, not a generic admin panel

Examples of the current UX direction:

- bottom navigation for phones
- a quick-action dashboard
- direct meal, workout, and weigh-in logging from primary screens
- dark mode with dedicated dashboard accent treatments instead of simply inverting colors

## Frontend Architecture

### Entry points

- `src/main.tsx` mounts the app
- `src/router.tsx` defines routes
- `src/components/layout/app-shell.tsx` owns login, shell layout, nav, and theme toggle

### Shared UI

- `src/components/ui.tsx` contains shared panels, form controls, empty states, and buttons
- `src/components/cards/stat-card.tsx` contains dashboard stat cards and mini chart cards

### Data access

- `src/lib/api.ts` contains the typed API client used by the app
- `src/lib/query-client.ts` configures TanStack Query

### Styling

- `src/styles.css` holds global theme variables, custom dark-mode behavior, and additional CSS not worth encoding as utility classes
- Tailwind configuration lives in `tailwind.config.ts`

### Production serving

The production image serves the built SPA with Nginx and proxies:

- `/api/*` to the FastAPI service
- `/.well-known/*` to the FastAPI service

This keeps the deployed browser experience on one origin:

- app: `http://localhost:8080`
- proxied API: `http://localhost:8080/api/v1/...`

## Environment Variables

The frontend uses a small environment surface.

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | API base used by the browser client | `/api/v1` |
| `VITE_AGENT_MANIFEST_URL` | manifest URL surfaced in the UI | `/.well-known/fitnesspal-agent.json` |

For most Docker usage, the defaults are correct because Nginx proxies requests to the backend.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

By default, Vite serves the app on `http://localhost:5173`.

To work correctly in local development:

- the backend should be running on `http://localhost:8000`
- backend CORS should allow `http://localhost:5173`

## Build and Deploy

Production build:

```bash
npm run build
```

Preview the built app locally:

```bash
npm run preview
```

Docker deployment from the repo root:

```bash
docker compose up --build -d web
```

## Current Caveats

- the frontend bundle still needs code splitting
- some advanced flows exist on the backend before they are fully exposed in polished frontend workflows
- this is a single-user app shell and does not attempt multi-user account management
