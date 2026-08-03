# CoachTrack Pro

Coaching-center management app for the Pakistani market (fees, vouchers,
attendance, tests, teacher payroll, parent communication). Design ported from
the Stitch project; localized to PKR + local payment rails (JazzCash, Easypaisa,
Raast, Bank Transfer/IBFT, Bank Challan).

## Structure

```
school/
├─ frontend/   Next.js 16 (App Router) + TypeScript + Tailwind v4
│  └─ src/
│     ├─ app/
│     │  ├─ layout.tsx           root layout (fonts + Material Symbols)
│     │  ├─ globals.css          "Professional Coaching Ledger" design tokens
│     │  ├─ page.tsx             redirects "/" -> "/dashboard"
│     │  ├─ (app)/               desktop pages wrapped in the shared AppShell
│     │  │  ├─ layout.tsx        renders <AppShell>
│     │  │  ├─ dashboard/ students/ students/register/ students/profile/
│     │  │  ├─ courses/ fees/ vouchers/ reminders/ reports/
│     │  │  └─ attendance/ tests/ teachers/ branches/ expenses/
│     │  ├─ parent/              parent mobile app (phone frame)
│     │  └─ settings/            settings (mobile)
│     ├─ components/AppShell.tsx sidebar (real nav) + topbar
│     └─ lib/nav.ts              sidebar navigation config
│
└─ backend/    Express + TypeScript REST API (mock data; DB added next)
   └─ src/
      ├─ server.ts               entry (PORT 4000)
      ├─ app.ts                  express app, CORS, /health, /api
      ├─ routes/index.ts         GET endpoints per module
      └─ data/mock.ts            mock PKR data
```

## Run

**Frontend** (http://localhost:3000)
```bash
cd frontend
npm install      # first time
npm run dev
```

**Backend** (http://localhost:4000, health at /health)
```bash
cd backend
npm install      # first time
npm run dev
```

## Notes

- Pages are faithful static renders of the approved designs. Interactivity and
  live data are wired in the **database phase** (next step), which will replace
  the backend's mock data and connect the frontend to `/api`.
- `REQUIREMENTS-GAP-ANALYSIS.md` documents the market-fit gaps and roadmap.
- Not yet built as screens: **Admissions & Inquiries CRM** (design generation
  hit a network timeout before we pivoted to the app build).
