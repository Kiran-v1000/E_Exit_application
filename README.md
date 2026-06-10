# ExitFlow — Employee Exit Management System

Full-stack exit/offboarding workflow: resignation → manager + HR approval → KT tasks → department clearances → exit survey → full & final settlement → closure. Premium UI with dark/light theme, gradients, and animations.

**Stack:** React (Vite) · Node.js + Express · PostgreSQL · JWT auth · 6 roles (employee, manager, hr, hod, finance, super_admin)

## Run locally

```bash
# 1. Database (Postgres must be running)
#    Create DB once:  CREATE DATABASE exitflow;
cd server
cp .env.example .env        # set your DB password in DATABASE_URL
npm install
npm run db:init             # creates schema + demo users
npm start                   # API on http://localhost:5000

# 2. Frontend
cd ../client
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :5000)
```

**Demo logins** (password `Pass@123`): `employee@exitflow.dev`, `priya@exitflow.dev`, `manager@`, `hr@`, `finance@`, `hod.it@`, `hod.admin@`, `hod.finance@`, `admin@` …exitflow.dev

**Smoke test** (full workflow via API): `cd server && node test/smoke.js`

## Deploy

- **Frontend → Vercel:** import the repo, set *Root Directory* = `client`, add env var `VITE_API_URL=https://<your-api-host>`. The included `client/vercel.json` handles SPA routing.
- **API + Postgres → Railway/Render** (Vercel doesn't host long-running Express + local Postgres): deploy `server/`, set `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN=https://<your-vercel-domain>`, then run `npm run db:init` once.

## Architecture doc

`index.html` at the repo root is a standalone interactive architecture document (schema, API routes, workflow).
