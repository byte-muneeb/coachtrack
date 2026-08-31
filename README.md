# CoachTrack Pro

Multi-tenant management software for **Pakistani coaching centers and schools** — fees, vouchers & collections, students, courses/batches, admissions, expenses, and reporting. One deployment serves many institutes ("entities"), each with its own branches, users, and fully isolated data. Localized to **PKR** and local payment methods (JazzCash, Easypaisa, Raast, Bank Transfer/IBFT, Bank Challan, Cheque).

## Stack

| Layer | Tech | Hosting |
|-------|------|---------|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind v4 | Vercel |
| Backend | Express + TypeScript REST API | Vercel (serverless function) |
| Database | PostgreSQL | Supabase |

## What it does today

- **Multi-tenant SaaS** — super-admin creates institutes (entities); each has branches, role-based users, and isolated data. Roles: `super_admin → entity_admin → {branch_manager, accountant, front_desk, teacher}` with per-branch scoping. Super-admin can impersonate an entity (audited).
- **Students** — registry, profiles, per-entity registry IDs, live outstanding.
- **Courses & Batches**, **Fee Components**, **Vouchers & Collections** (installments, late fees, exam-fee charge, transactional payments), **Enrollments & Transfers**.
- **Admissions/Inquiries CRM**, **Expenses & Profit**, **Dashboard & Reports**, **Audit log**.
- **CSV/XLSX bulk import** for courses and students (case-insensitive matching, dry-run preview, dedupe).
- **Fee reminders** — rule + template engine and queue preview (⚠️ actual WhatsApp/SMS *sending* is not yet wired).

See **[ROADMAP.md](ROADMAP.md)** for what's next (the full-academy-ERP plan) and **[REQUIREMENTS-GAP-ANALYSIS.md](REQUIREMENTS-GAP-ANALYSIS.md)** for the Pakistan market research behind it.

## Structure

```
school/
├─ frontend/   Next.js 16 App Router
│  └─ src/
│     ├─ app/
│     │  ├─ login/                 login (role-based redirect)
│     │  ├─ admin/                 super-admin console (entities, impersonate)
│     │  └─ (app)/                 entity app in the shared AppShell:
│     │     dashboard/ students/ students/register/ import/ admissions/
│     │     courses/ fees/ vouchers/ reminders/ expenses/ reports/
│     │     branches/ users/ audit/ settings/
│     ├─ components/AppShell.tsx   sidebar + topbar (role-gated nav)
│     └─ lib/api.ts                typed API client + auth storage
│                lib/nav.ts, lib/parseSpreadsheet.ts, lib/exportCsv.ts
│
└─ backend/    Express + TypeScript REST API
   └─ src/
      ├─ server.ts / app.ts        entry + express app (CORS, /health, /api)
      ├─ db.ts                     Postgres layer + tenant-aware schema
      ├─ auth.ts                   token (entityId/role) + password hashing
      ├─ tenant.ts                 tenant-context middleware + scope helpers
      ├─ importUtils.ts            case-insensitive CSV/XLSX row helpers
      ├─ audit.ts                  audit logging
      └─ routes/                   students, courses, fees, vouchers, enrollments,
                                   expenses, inquiries, reminders, settings,
                                   branches, auth, audit, admin, internal, stats
```

## Run locally

**Backend** (http://localhost:4000, health at `/health`)
```bash
cd backend
npm install
# copy .env.example -> .env and set DATABASE_URL (Supabase), AUTH_SECRET, CRON_SECRET
npm run dev
```

**Frontend** (http://localhost:3000)
```bash
cd frontend
npm install
# .env.local: NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev
```

**Seed demo data** (drops + rebuilds the schema, creates a super admin + 2 demo institutes):
```bash
cd backend && npx tsx src/seed.ts
```
Demo logins (all password `admin123`): `superadmin`, `ali-admin`, `ali-accountant`, `bright-admin`, `bright-accountant`.

## Deploy

Two Vercel projects from this one repo — backend (Root Directory `backend`) and frontend (Root Directory `frontend`) — plus a Supabase database. Full step-by-step in **[DEPLOYMENT.md](DEPLOYMENT.md)**.
