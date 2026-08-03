# CoachTrack Pro — Completion Plan (to a real SaaS web app)

**Date:** 2026-07-20
**Reviewed state:** frontend (Next.js 16) + backend (Express + `mssql`) + MS SQL `coachtrack`.

---

## 0. Where the project is today

| Area | Status |
|------|--------|
| **Students** module | ✅ Functional — real React UI + CRUD API + `dbo.Students` table |
| Other 13 pages (dashboard, courses, fees, vouchers, reminders, reports, attendance, tests, teachers, branches, expenses, parent, settings) | ⚠️ Static design dumps (`dangerouslySetInnerHTML`) on **mock** endpoints |
| Database | ⚠️ Only `Students` real; leftover `Student` + `_prisma_migrations` tables to drop; no relations/FKs; no migration tooling |
| **Auth / login** | ❌ None |
| **Multi-tenancy** (multiple institutes on one app) | ❌ None — the core of "SaaS" |
| **Subscriptions / billing** | ❌ None |
| Payments (JazzCash/Easypaisa/Raast/1Bill) | ❌ None (design only) |
| WhatsApp / SMS | ❌ None (design only) |
| Security (authz, validation, rate-limit, helmet, secrets) | ❌ None; CORS wide open; password in `.env` |
| Testing / CI/CD / git | ❌ None (no git repo) |
| Deployment / hosting | ❌ Local dev only |

---

## 1. Make every feature module functional (like Students)

For **each** module: DB table(s) + relations → backend CRUD/validation → rebuild the static page as interactive React → wire to API. Recommended order (dependencies first):

1. **Courses & Batches** — course master + batches, fee mapping, teacher assignment. Feeds Student enrollment dropdowns.
2. **Fee Definition** — fee components (type, frequency, amount, applicability).
3. **Vouchers & Collections** — generate vouchers from student+fees, record payments, statuses, PDF voucher, auto-update outstanding.
4. **Attendance** — daily marking per batch, %, (biometric import later), absence alerts.
5. **Tests & Results** — tests, MCQ bank, marks entry, result cards, ranking.
6. **Teacher Payroll & Revenue Share** — teachers, salary + per-student/%-share payout.
7. **Expenses & Profit** — expense entries, categories, income vs expense, net profit.
8. **Branches** — branch entity + `branchId` on all records + consolidated view.
9. **Reminders** — reminder rules + templates + scheduled queue (needs comms integration, §4).
10. **Reports** — real aggregations over the above (revenue, outstanding, defaulters, collection %).
11. **Dashboard** — live KPIs/charts from real data (build last; depends on all).
12. **Admissions & Inquiries CRM** — *screen not even generated yet*; build lead pipeline + walk-in/trial.
13. **Parent app + Settings (mobile)** — wire to real data once parent auth exists.

**Data-model work:** foreign keys & relations (Student→Course/Batch/Branch, Voucher→Student/Fee, Payment→Voucher, Attendance→Student/Batch, etc.), indexes, cascade rules, soft-delete strategy.

---

## 2. SaaS foundations (the biggest missing layer)

This is what turns it from "an app" into "a SaaS product."

- **Authentication** — signup, login, logout, password reset, email verification, session/JWT, refresh tokens, "remember me". Libraries: e.g. Auth.js/NextAuth or custom JWT + bcrypt.
- **Multi-tenancy** — an `Institute`/`Tenant` entity; **every table gets `tenantId`**; every query scoped to the tenant; strict isolation so one center can never see another's data. Decide model: shared DB + tenantId (simplest) vs schema/DB per tenant.
- **Roles & permissions (RBAC)** — Owner/Admin, Registrar, Accountant, Teacher, Parent, Super-Admin. Route + UI guards.
- **Tenant onboarding** — self-serve "create your institute" flow, first-admin setup, initial config (branches, courses).
- **Subscription & billing** — plans (Free ≤N students, paid tiers), plan limits enforcement, trial period, upgrade/downgrade, invoices; billing provider (local: card via Safepay/PayFast, or manual/bank for PK market).
- **Super-Admin panel** — you (the vendor) manage tenants, plans, usage, suspensions.
- **Usage metering & limits** — enforce per-plan caps (students, SMS/WhatsApp credits, branches).

---

## 3. Payments & fee collection integration (PK market core)

- Integrate **JazzCash, Easypaisa, Raast** (QR / request-to-pay), **1Bill/1LINK biller**, bank challan, cash.
- Aggregator option to cover all at once: **KuickPay / PayPro / Safepay / PayFast**.
- Payment gateway **webhooks → auto-reconcile** voucher → mark paid → receipt.
- Configurable **provincial tax** (0% / exempt / 3%), no hardcoded 5%.
- **PDF** fee vouchers & receipts (with 1Bill number / QR).

## 4. Communications

- **WhatsApp Business API** (via BSP: Wati/Interakt/360dialog or local WeTarseel) — utility templates for fee reminders, receipts, attendance/absence, results.
- **SMS gateway** fallback (VeevoTech/SendPK/Branded SMS).
- **Email** (transactional: verification, reset, receipts) — e.g. Resend/SES.
- **Scheduler/queue** for reminder rules (cron/BullMQ) + delivery logs + retry/fallback.
- Template management per tenant.

---

## 5. Cross-cutting engineering (needed app-wide)

- **Input validation** — shared schemas (e.g. **zod**) on backend + frontend; reject bad input with clear errors.
- **Forms** — `react-hook-form` + zod resolver (replace hand-rolled state); field-level errors.
- **Data fetching/cache** — TanStack Query (loading/error/refetch/optimistic updates) instead of manual `useEffect` in every page.
- **Toasts & modals** — replace `window.confirm`/`alert` with proper toast + confirm dialog components.
- **File uploads/storage** — student photos, syllabus PDFs, logos → storage (S3/Azure Blob/local) + serving.
- **PDF generation** — vouchers, receipts, result cards, ID cards.
- **Loading/empty/error states** — standardize across all pages.
- **Pagination & server-side filtering** — for large registries/tables.

---

## 6. Database & data management

- **Migration tooling** — adopt a real migration workflow for `mssql` (e.g. a migrations runner / `node-mssql` migration scripts / Knex) instead of ad-hoc `ensureSchema`.
- **Relations, FKs, indexes, constraints** across all tables.
- **Seed data** for demo/dev.
- **Cleanup:** drop leftover `Student` and `_prisma_migrations` tables.
- **Backups & restore** plan; connection pooling (already via mssql) tuned.
- **Data import** — bulk Excel/CSV import (student migration is the #1 onboarding blocker).

---

## 7. Security & compliance

- **AuthN/AuthZ** on every API route (currently fully open).
- **Tenant isolation** enforced at the data layer.
- **Secrets management** — move DB password/API keys out of committed files; use env/secret store; rotate the dev password before prod.
- **helmet**, **rate limiting**, **CORS allowlist** (currently `cors()` open to all), request size limits.
- **Password hashing** (bcrypt/argon2), lockout, strong-password policy.
- **Audit log** — who changed fees/marked payments/deleted records.
- **Input sanitization** / parameterized queries (already parameterized — keep it).
- **PII handling** — student/guardian data; least-privilege DB account for the app (drop `dbcreator` in prod).

---

## 8. Quality: testing, CI, observability

- **Automated tests** — unit (services), integration (API + DB), e2e (Playwright) for critical flows (enroll, collect fee, mark attendance).
- **CI/CD** — lint + typecheck + test + build on push; auto-deploy.
- **Linting/formatting** — ESLint (present in FE) + Prettier; add to backend.
- **Structured logging** (pino/winston) + **error tracking** (Sentry).
- **Health/readiness endpoints** (fix `/health` — it currently always says `db: not_connected`).
- **Performance** — query indexes, N+1 avoidance, response caching where safe.

---

## 9. DevOps & deployment

- **Initialize git** (no repo yet) + `.gitignore` (node_modules, .env, .next, scratch PNGs) + repo hosting.
- **Environments** — dev/staging/prod config separation.
- **Hosting** — frontend (Vercel/Azure Static/Node host), backend (Azure App Service / VM / container), **MS SQL** (Azure SQL or managed instance).
- **Containerization** (Docker) for backend + reproducible builds; production build for backend (`tsc` currently would choke on generated Prisma files — remove them).
- **Domains + SSL/HTTPS**, reverse proxy, environment secrets in the platform.
- **DB backups, migrations-on-deploy, monitoring/alerts**.

---

## 10. UX / product polish

- **Responsive/mobile** layout for admin pages (currently fixed 280px sidebar, desktop-only).
- **Accessibility** (labels, focus, keyboard, contrast).
- **Global nav feedback** — active states (done), breadcrumbs, per-page titles.
- **Settings** — tenant profile, branding/logo, fee/tax config, payment & messaging credentials, users management.
- **Parent portal auth** + real data.
- **Bilingual readiness** (kept English per your instruction; leave i18n hooks for later).
- **Onboarding/empty-state guidance** for new tenants.

---

## 11. Business / go-to-market layer

- **Marketing/landing site** + **pricing page** + signup CTA.
- **Self-serve trial → paid** conversion flow.
- **Docs/help**, in-app support, terms/privacy.
- **Analytics** (product usage) for you as the vendor.

---

## Suggested phasing

- **Phase 1 — Foundations:** git + cleanup, auth, multi-tenancy (`tenantId` everywhere), RBAC, security baseline (helmet/rate-limit/CORS allowlist), migration tooling, shared validation + data-fetching + forms + toasts.
- **Phase 2 — Core modules functional:** Courses → Fees → Vouchers/Collections → Attendance → Tests → Teachers → Expenses → Branches → Reports → Dashboard → Admissions. (One at a time, like Students.)
- **Phase 3 — PK integrations:** payment gateways + reconciliation, WhatsApp/SMS/email + reminder scheduler, PDF vouchers/receipts/result cards, Excel import.
- **Phase 4 — SaaS commerce:** subscription plans + limits + billing, tenant onboarding, super-admin panel.
- **Phase 5 — Harden & ship:** tests, CI/CD, logging/monitoring, deployment (Azure SQL + hosting), backups, marketing site + pricing.

---

### Immediate cleanups (quick wins)
- `git init` + `.gitignore`; move screenshot PNGs out of repo root.
- Drop `Student` + `_prisma_migrations` tables (Prisma fully removed).
- Fix `/health` to report real DB status.
- Lock down CORS to the frontend origin; add helmet + rate limiter.
