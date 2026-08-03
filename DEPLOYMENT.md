# Deploying CoachTrack Pro — Vercel (×2) + Azure SQL (free tiers)

Everything runs on free tiers: **two Vercel projects** from this one repo (frontend + backend), and the database on **Azure SQL Database (free serverless tier)**. Because Azure SQL *is* SQL Server, the existing `mssql` code runs against it with **no database rewrite**.

> **New to this project?** Read this whole file top to bottom once, then do the steps in order. The five steps below take ~30–45 minutes total. You do **not** need to touch any code — this is a deploy-and-configure job.

## What you need before starting (accounts + tools)

| Thing | Why | Cost |
|-------|-----|------|
| **GitHub account** + this repo pushed to it | Vercel deploys from GitHub | Free |
| **Vercel account** (sign up with the GitHub account) | Hosts frontend + backend | Free (Hobby) |
| **Microsoft Azure account** | Hosts the SQL database | Free tier (credit card required for signup, not charged on free DB) |
| **Node.js 18+** + **Git** on your machine | Only for optional local testing / pushing to GitHub | Free |

**Two secrets you must generate yourself** (any long random string — e.g. run `openssl rand -hex 32` or use a password generator):
- `AUTH_SECRET` — signs login tokens
- `CRON_SECRET` — protects the daily voucher-generation cron

Keep them somewhere safe; you'll paste both into Vercel in Step 3.

## Deployment checklist (tick as you go)

- [ ] **Step 1** — Azure SQL Database created; you have `DB_SERVER / DB_NAME / DB_USER / DB_PASSWORD`, and "Allow Azure services" is ON
- [ ] **Step 2** — Repo pushed to GitHub (confirm `.env` files are NOT in the repo)
- [ ] **Step 3** — Backend Vercel project deployed (Root Directory = `backend`); `/health` returns OK
- [ ] **Step 4** — Frontend Vercel project deployed (Root Directory = `frontend`) with `NEXT_PUBLIC_API_URL` = backend URL
- [ ] **Step 5** — Logged in as `admin` / `admin123` and **changed the password**

```
                 ┌───────────────────────────────────────────────┐
 Browser ───────►│ Vercel project #1  (Root Directory: frontend) │  Next.js UI
                 └───────────────────────┬───────────────────────┘
                       NEXT_PUBLIC_API_URL│  (browser → API)
                 ┌───────────────────────▼───────────────────────┐
                 │ Vercel project #2  (Root Directory: backend)  │  Express as
                 │   backend/api/index.ts  ← all paths rewritten  │  serverless fn
                 └───────────────────────┬───────────────────────┘
                                         │ mssql (encrypted, 1433)
                 ┌───────────────────────▼───────────────────────┐
                 │ Azure SQL Database (free serverless, 32 GB)    │
                 └───────────────────────────────────────────────┘
```

> Two Vercel projects can import the **same** GitHub repo; each just uses a different **Root Directory**. Both are allowed on the free (Hobby) plan.

---

## Step 1 — Database: Azure SQL Database (free tier)

1. In the Azure Portal, create a **SQL Database**. On the pricing/compute step choose **General Purpose → Serverless** and apply the **free offer** (Microsoft's always-free Azure SQL DB: serverless compute + 32 GB, one free DB per subscription — confirm current terms when creating).
2. Create/choose a **logical server** (`your-server.database.windows.net`) with a SQL admin login + password.
3. **Networking:** enable **"Allow Azure services and resources to access this server"** (so Vercel's functions can connect), or add outbound IP ranges. Keep "Enforce SSL" on (the app already sets `encrypt: true`).
4. Note these — you'll paste them into Vercel:
   - `DB_SERVER` = `your-server.database.windows.net`
   - `DB_PORT` = `1433`
   - `DB_NAME` = your database name
   - `DB_USER` / `DB_PASSWORD` = the SQL login

The app creates all tables itself on first request (`ensureSchema`) and seeds a default admin — no manual migration needed.

## Step 2 — Push this repo to GitHub

```bash
git add -A
git status        # confirm .env.txt and backend/.env are NOT listed
git commit -m "Prepare CoachTrack for Vercel + Azure deployment"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```
Secrets are already excluded by the root `.gitignore`.

## Step 3 — Backend: Vercel project #2

1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory: `backend`.**
3. Framework preset: **Other** (Vercel auto-detects the `api/` serverless function; `backend/vercel.json` rewrites every path to it and registers the cron).
4. **Environment Variables** (Production + Preview):

   | Key | Value |
   |-----|-------|
   | `DB_SERVER` | `your-server.database.windows.net` |
   | `DB_PORT` | `1433` |
   | `DB_NAME` | your DB name |
   | `DB_USER` | SQL login |
   | `DB_PASSWORD` | SQL password |
   | `AUTH_SECRET` | long random string |
   | `CRON_SECRET` | long random string (Vercel Cron sends this as a Bearer token) |

5. **Deploy.** Test: open `https://<backend>.vercel.app/health` → `{"status":"ok",...}`. First hit may take ~30–60 s if the Azure DB was paused (see caveats).

## Step 4 — Frontend: Vercel project #1

1. Vercel → **Add New → Project** → import the **same** repo again.
2. **Root Directory: `frontend`.** Framework: **Next.js** (auto).
3. **Environment Variable** (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = `https://<backend>.vercel.app`  (no trailing slash)
   - ⚠️ This is inlined at **build time** — set it before deploying; change it later → **redeploy**.
4. **Deploy.** Verified locally: `next build` → 21 routes, exit 0.

## Step 5 — First login & hardening

- Open the frontend URL, sign in with **`admin` / `admin123`**.
- **Immediately change the admin password** (Users page) — it's seeded on first boot.
- Optional: restrict CORS in `backend/src/app.ts` (currently open) to your frontend domain.

---

## How the serverless backend works (what changed)

- **`backend/api/index.ts`** exports the Express `app` as the function handler; **`backend/vercel.json`** rewrites `/(.*)` → `/api`, so Express handles all routing.
- **Schema on first request:** `ensureSchemaOnce()` (in `db.ts`) runs the DDL once per warm instance via a memoized middleware — there's no server "boot" on serverless.
- **Scheduler → Vercel Cron:** the old in-process `setInterval` is gone. `vercel.json` runs a daily cron hitting `POST /api/internal/auto-generate`, which checks the configured `autoGenDay` and generates only when due (guarded by `CRON_SECRET`).

## Caveats (free-tier realities)

1. **Vercel Hobby is non-commercial** per Vercel's ToS — fine for demo/testing/handoff; a live paying business needs Pro.
2. **Function timeout (~10–60 s).** Normal CRUD is instant, but **"Generate Monthly Vouchers" for a very large centre** could exceed the limit. Small/medium centres are fine; otherwise batch it.
3. **Azure SQL free serverless auto-pauses after ~1 h idle** → the first request after idle takes ~30–60 s to wake and can time out once; a retry succeeds. Fine for low traffic.
4. **Serverless DB connections:** each warm instance keeps one pooled connection (`getPool` is memoized). Low free-tier traffic stays well within limits.
5. **Vercel Hobby cron** runs at daily granularity — matches monthly generation (fires daily, acts only on `autoGenDay`).

## Local development

```bash
# backend  (needs SQL Server/Azure SQL reachable + backend/.env from .env.example)
cd backend  && npm install && npm run dev     # http://localhost:4000

# frontend (second terminal)
cd frontend && npm install && npm run dev     # http://localhost:3000
```
Sign in with `admin` / `admin123`.

## Environment variable reference

**Frontend** (`frontend/.env.example`): `NEXT_PUBLIC_API_URL`
**Backend** (`backend/.env.example`): `PORT` (local only), `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`

> Copy `*.env.example` → `.env` (backend) / `.env.local` (frontend) and fill in real values for **local** dev only. Never commit these — they are already git-ignored. On Vercel you set the same keys in the dashboard, not in a file.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|--------|--------------------|
| Frontend loads but every action fails / "Network error" | `NEXT_PUBLIC_API_URL` is wrong or has a trailing slash. Fix it in the frontend Vercel project → **redeploy** (it's baked in at build time). |
| Backend `/health` times out on the first try | Azure SQL auto-paused after idle — wait ~60 s and retry once; it wakes up. |
| Backend returns 500 on DB calls | Check the 5 `DB_*` env vars in the backend project, and that **"Allow Azure services and resources to access this server"** is ON in Azure networking. |
| Can't log in with `admin` / `admin123` | The seed runs on the first successful DB request. Hit `/health` once (wakes DB + seeds), then try again. |
| Login works but session drops immediately | `AUTH_SECRET` differs between deploys or is empty — set a stable value and redeploy the backend. |
| Cron / auto-generate returns 401 | `CRON_SECRET` in Vercel env must match; Vercel Cron sends it as a Bearer token automatically once set. |
| Changed an env var but nothing changed | Vercel only applies env vars on a **new deployment** — trigger a redeploy after any change. |

## Where things live (quick map for the deployer)

```
school/
├── DEPLOYMENT.md          ← this guide
├── README.md              ← product overview
├── backend/               ← Vercel project #2 (Root Directory = backend)
│   ├── api/index.ts        ← serverless entry (exports Express app)
│   ├── vercel.json         ← rewrites all paths → api + daily cron
│   ├── src/                ← routes, auth, db, seed
│   └── .env.example        ← backend env template
└── frontend/              ← Vercel project #1 (Root Directory = frontend)
    ├── src/app/            ← Next.js pages
    ├── src/lib/api.ts      ← calls NEXT_PUBLIC_API_URL
    └── .env.example        ← frontend env template
```
