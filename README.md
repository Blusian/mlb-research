# MLB Research App

Baseball prop research workspace with a React + Vite frontend and a FastAPI backend. The app focuses on matchup analysis, player detail pages, projected and official lineup-aware prop boards, selected prop tracking, and live game progress monitoring.

## Current Architecture

- Frontend: React 19 + Vite in `frontend/`
- Active backend API: FastAPI in `app/`
- Shared types: `packages/shared/`
- Legacy modeling/runtime tooling: `backend/`

The deployed web app should use the FastAPI service in `app/`. The `backend/` workspace stays in the repo as supporting tooling, but it is not the runtime API the current frontend calls.

## How The App Communicates

- Frontend API client: `frontend/src/api/client.ts`
- Local development API base URL fallback: `http://127.0.0.1:4000`
- Deployed frontend: requires `VITE_API_BASE_URL`

In production, the frontend must point at a separately hosted FastAPI backend.

## Local Requirements

- Node.js 22
- npm 10+
- Python 3.12 recommended

## Environment Variables

Copy the example files and fill in the values you actually need.

- Root backend and local full-stack envs: `.env.example`
- Frontend and Vercel envs: `frontend/.env.example`

Important backend envs:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `SEASON_YEAR`
- `LIVE_PROVIDER_TIMEOUT_MS`
- `LIVE_GAME_FEED_TIMEOUT_MS`
- `LIVE_GAME_FEED_MAX_WORKERS`

Important frontend envs:

- `VITE_API_BASE_URL`

## Local Setup

1. Install Node dependencies:

```bash
npm install
```

2. Install Python dependencies:

```bash
python -m pip install -r requirements.txt
```

3. Create env files:

```bash
copy .env.example .env
copy frontend\.env.example frontend\.env.local
```

4. Start the full local app:

```bash
npm run dev
```

That starts:

- Vite frontend
- FastAPI backend at `http://127.0.0.1:4000`

If you only want the API:

```bash
npm run dev:api
```

## Useful Scripts

- `npm run dev` - run frontend + FastAPI locally
- `npm run dev:api` - run only FastAPI
- `npm run build:web` - build shared package and frontend only
- `npm run typecheck:web` - typecheck shared package and frontend only
- `npm run lint:web` - lint shared package and frontend only
- `npm run python:test` - run FastAPI/backend regression tests

## Vercel Deployment

Use one Vercel project for the frontend only. Host FastAPI separately.

### Recommended Vercel Settings

- Project type: single frontend project
- Root directory: `/`
- Framework preset: `Vite`
- Install command: `npm install`
- Build command: `npm run build:web`
- Output directory: `frontend/dist`
- Node version: `22`

### Vercel Environment Variables

Set this in Vercel for preview and production:

```bash
VITE_API_BASE_URL=https://your-fastapi-host
```

Do not rely on localhost in deployed environments. The frontend now throws a clear configuration error if `VITE_API_BASE_URL` is missing outside local development.

## Backend Hosting Notes

The FastAPI backend should be hosted outside this Vercel frontend project.

Recommended backend host for this repo: Railway.

Current production considerations:

- The app uses backend-side persistence and caching assumptions that are not a fit for a frontend-only Vercel deployment.
- Use a real hosted database for production instead of local SQLite files.
- Set `CORS_ORIGINS` to include your Vercel frontend domain.
- Railway is a good fit for this project because it handles long-running backend services, managed Postgres, and future worker or cron expansion more naturally than a frontend-focused serverless deployment.

### Railway Backend

The repo includes Railway-ready backend deployment files:

- `Dockerfile`
- `.dockerignore`
- `railway.json`

The Railway backend should use:

- `DATABASE_URL` from a managed Postgres service
- `CORS_ORIGINS=https://mlb-research.vercel.app`

After Railway gives you a public backend domain, set this on the Vercel frontend project:

```bash
VITE_API_BASE_URL=https://your-backend.up.railway.app
```

## CI

GitHub Actions validates the active stack:

- frontend/shared lint
- frontend/shared typecheck
- frontend build
- Python backend tests

Workflow file:

- `.github/workflows/ci.yml`

## GitHub Setup

If this folder is not already a git repo, initialize and push with:

```bash
git init -b main
git add .
git commit -m "Prepare frontend for Vercel and harden live tracking"
git remote add origin https://github.com/Blusian/mlb-research.git
git push -u origin main
```

### Verify The Remote

```bash
git remote -v
```

### If The Remote Already Has Files Later

If the remote later gets a README or another initial commit before your first push:

```bash
git fetch origin
git pull origin main --allow-unrelated-histories
git push -u origin main
```

Resolve any merge conflict before the final push.

## Files And Folders That Should Not Be Committed

Never commit:

- `.env`
- `frontend/.env`
- `frontend/.env.local`
- `.venv/`
- `venv/`
- `node_modules/`
- `.vercel/`
- `frontend/dist/`
- `packages/*/dist/`
- `database/*.sqlite3`
- `*.db`
- `*.log`
- editor or OS junk such as `.vscode/`, `.idea/`, `.DS_Store`, `Thumbs.db`

The root `.gitignore` is set up to exclude these.
