# RangeOps — Shooting Range Management

React and TypeScript frontend for the SQLite-backed RangeOps API.

## Run locally

Start the backend on `http://127.0.0.1:3001`, then run the frontend:

```bash
npm install
npm run dev
```

The Vite development server proxies `/api` requests to the backend. Build the production bundle with `npm run build`.

## Mock demo mode

The frontend uses the backend by default. Set `VITE_USE_MOCK=true` only for a standalone demo; the old seeded mock data and browser persistence are loaded only in that mode. Do not set this flag in `.env` or `.env.local` for a backend-connected deployment.

## API-backed workflows

Authentication, participants, Excel import, scan, transaction queries, users, settings, labels, printing, dashboard metrics, and reports use the backend API. Zustand contains session and UI state; only the dark/light theme preference is persisted by the production frontend.

The backend currently has no transaction-correction endpoint or general activity-log listing endpoint. Reports derive available activity rows from transactions where possible. Server-side backup and demo reset endpoints are also not available.
