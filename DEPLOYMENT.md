# Deploying CoachTrack Pro — Vercel (×2) + Supabase Postgres (free tiers)

Everything runs on free tiers with **no credit card**: **two Vercel projects** from this one repo (frontend + backend), and the database on **Supabase (free Postgres)**. The backend talks to Postgres via the `pg` driver; a small compatibility layer in `backend/src/db.ts` lets the original SQL run on Postgres unchanged.

> **New to this project?** Read this whole file top to bottom once, then do the steps in order. Total time ~25–40 minutes. You do **not** need to touch any code — this is a deploy-and-configure job.

## What you need before starting (accounts + tools)

| Thing | Why | Cost |
|-------|-----|------|
| **GitHub account** + this repo pushed to it | Vercel deploys from GitHub | Free |
| **Vercel account** (sign up with GitHub) | Hosts frontend + backend | Free (Hobby) |
| **Supabase account** (sign up with GitHub) | Hosts the Postgres database | Free — **no credit card** |
| **Node.js 18+** + **Git** (optional) | Only for local testing / pushing to GitHub | Free |

**Two secrets you must generate yourself** (any long random string — e.g. `openssl rand -hex 32`):
- `AUTH_SECRET` — signs login tokens
- `CRON_SECRET` — protects the daily voucher-generation cron

Keep them safe; you'll paste both into Vercel in Step 3.

## Deployment checklist (tick as you go)

- [ ] **Step 1** — Supabase project created; you have the **Transaction pooler** connection string (`DATABASE_URL`)
- [ ] **Step 2** — Repo pushed to GitHub (confirm `.env` files are NOT in the repo)
- [ ] **Step 3** — Backend Vercel project deployed (Root Directory = `backend`); `/health` returns OK
- [ ] **Step 4** — Frontend Vercel project deployed (Root Directory = `frontend`) with `NEXT_PUBLIC_API_URL` = backend URL (no trailing slash)
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
                                         │ pg (SSL, transaction pooler :6543)
                 ┌───────────────────────▼───────────────────────┐
                 │ Supabase Postgres (free tier)                  │
                 └───────────────────────────────────────────────┘
```

> Two Vercel projects can import the **same** GitHub repo; each just uses a different **Root Directory**. Both are allowed on the free (Hobby) plan.

---

## Step 1 — Database: Supabase (free, no card)

1. Go to **supabase.com** → sign in with GitHub → **New project**.
2. Pick an **organization** (free), a **project name** (e.g. `coachtrack`), and set a **database password** — save it. Choose the **region** nearest your users. Create the project (takes ~2 min to provision).
3. Get the connection string: **Project Settings → Database → Connection string**. Choose the **"Transaction" pooler** tab (host ends in `...pooler.supabase.com`, port **6543**). This pooler is the one that works from serverless functions.
   - It looks like: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   - Replace `<password>` with the database password from step 2. This whole string is your **`DATABASE_URL`**.

The app creates all tables itself on first request (`ensureSchema`) and seeds a default admin — **no manual SQL, no migration**. (You can watch the tables appear in Supabase → **Table Editor** after the first request.)

## Step 2 — Push this repo to GitHub

```bash
git add -A
git status        # confirm .env / .env.txt / backend/.env are NOT listed
git commit -m "CoachTrack on Supabase Postgres"
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
   | `DATABASE_URL` | the Supabase **Transaction pooler** string from Step 1 |
   | `AUTH_SECRET` | long random string |
   | `CRON_SECRET` | long random string (Vercel Cron sends this as a Bearer token) |

5. **Deploy.** Test: open `https://<backend>.vercel.app/health` → `{"status":"ok",...}`. Then trigger the DB by logging in (Step 5); the first data request creates the schema + admin.

## Step 4 — Frontend: Vercel project #1

1. Vercel → **Add New → Project** → import the **same** repo again.
2. **Root Directory: `frontend`.** Framework: **Next.js** (auto).
3. **Environment Variable** (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = `https://<backend>.vercel.app`  **(no trailing slash)**
   - ⚠️ This is inlined at **build time** — set it before deploying; change it later → **redeploy**.
4. **Deploy.**

## Step 5 — First login & hardening

- Open the frontend URL, sign in with **`admin` / `admin123`**.
- **Immediately change the admin password** (Users page) — it's seeded on first boot.
- Optional: restrict CORS in `backend/src/app.ts` (currently open) to your frontend domain.

---

## How the serverless backend works (what changed)

- **`backend/api/index.ts`** exports the Express `app` as the function handler; **`backend/vercel.json`** rewrites `/(.*)` → `/api`, so Express does all routing.
- **Postgres via a compatibility shim:** `backend/src/db.ts` wraps `pg` but keeps the original `pool.request().input().query()` API. It translates the mechanical T-SQL-isms (named params → `$1`, `SYSUTCDATETIME()`/`ISNULL` → `now()`/`COALESCE`, `OUTPUT INSERTED` → `RETURNING`, `TOP` → `LIMIT`, `WITH (UPDLOCK)` → `FOR UPDATE`) and remaps result keys back to camelCase. The few T-SQL-only queries (dashboard stats, upserts, registry-number logic) were rewritten to Postgres directly.
- **Schema on first request:** `ensureSchemaOnce()` runs the DDL once per warm instance via a memoized middleware — there's no server "boot" on serverless.
- **Scheduler → Vercel Cron:** `vercel.json` runs a daily cron hitting `POST /api/internal/auto-generate`, which acts only on the configured `autoGenDay` (guarded by `CRON_SECRET`).

## The SQL Server (mssql) version is preserved

The app originally ran on SQL Server / Azure SQL. That entire backend is zipped at **`_backups/coachtrack-mssql-backend-backup.zip`** for future use. To switch back you'd restore `src/` from the zip and set the `DB_*` variables instead of `DATABASE_URL`.

## Caveats (free-tier realities)

1. **Vercel Hobby is non-commercial** per Vercel's ToS — fine for demo/testing/handoff; a live paying business needs Pro.
2. **Function timeout (~10–60 s).** Normal CRUD is instant, but **"Generate Monthly Vouchers" for a very large centre** could exceed the limit. Small/medium centres are fine; otherwise batch it.
3. **Use the transaction pooler (port 6543), not the direct connection (5432)** for the Vercel backend — serverless functions open many short-lived connections and the pooler is built for that.
4. **Supabase free projects pause after ~1 week of inactivity** — the first request after a pause wakes it (may take a few seconds). Fine for low traffic.

## Local development

```bash
# backend  (copy backend/.env.example → backend/.env, set DATABASE_URL to your Supabase string)
cd backend  && npm install && npm run dev     # http://localhost:4000

# frontend (second terminal)
cd frontend && npm install && npm run dev     # http://localhost:3000
```
Sign in with `admin` / `admin123`. For a local (non-SSL) Postgres instead of Supabase, set `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` and `PGSSL=disable` instead of `DATABASE_URL`.

## Environment variable reference

**Frontend** (`frontend/.env.example`): `NEXT_PUBLIC_API_URL`
**Backend** (`backend/.env.example`): `DATABASE_URL` (Supabase), `AUTH_SECRET`, `CRON_SECRET`, `PORT` (local only). Legacy `DB_*` (mssql) and `PG*` (local Postgres) are supported fallbacks.

> Copy `*.env.example` → `.env` (backend) / `.env.local` (frontend) and fill in real values for **local** dev only. Never commit these — they are already git-ignored. On Vercel you set the same keys in the dashboard, not in a file.

---

## Troubleshooting

| Symptom | Likely cause & fix |
|--------|--------------------|
| Frontend loads but every action fails / "Failed to fetch" | `NEXT_PUBLIC_API_URL` is wrong or has a **trailing slash**. Fix it in the frontend Vercel project → **redeploy** (it's baked in at build time). |
| Login blocked by CORS, URL shows `//api/...` (double slash) | Trailing slash on `NEXT_PUBLIC_API_URL`. Remove it → redeploy frontend. |
| Backend returns 500 on login / data calls | Check `DATABASE_URL` in the backend project — must be the **Transaction pooler** string with the real password. Read the exact error in Vercel → **Runtime Logs**. |
| 500 with "no pg_hba"/SSL/timeout | Ensure you used the **pooler** host (`...pooler.supabase.com:6543`), not the direct `db.<ref>.supabase.co:5432`. SSL is on by default in the app. |
| Can't log in with `admin` / `admin123` | The seed runs on the first successful DB request. Hit `/health`, then try login again (login itself triggers the seed). |
| Login works but session drops immediately | `AUTH_SECRET` differs between deploys or is empty — set a stable value and redeploy the backend. |
| Cron / auto-generate returns 401 | `CRON_SECRET` in Vercel env must match; Vercel Cron sends it as a Bearer token automatically once set. |
| Changed an env var but nothing changed | Vercel only applies env vars on a **new deployment** — trigger a redeploy after any change. |

## Where things live (quick map for the deployer)

```
school/
├── DEPLOYMENT.md          ← this guide
├── README.md              ← product overview
├── _backups/              ← coachtrack-mssql-backend-backup.zip (SQL Server version)
├── backend/               ← Vercel project #2 (Root Directory = backend)
│   ├── api/index.ts        ← serverless entry (exports Express app)
│   ├── vercel.json         ← rewrites all paths → api + daily cron
│   ├── src/db.ts           ← Postgres (pg) + T-SQL→Postgres compatibility shim
│   ├── src/                ← routes, auth, seed
│   └── .env.example        ← backend env template
└── frontend/              ← Vercel project #1 (Root Directory = frontend)
    ├── src/app/            ← Next.js pages
    ├── src/lib/api.ts      ← calls NEXT_PUBLIC_API_URL
    └── .env.example        ← frontend env template
```
