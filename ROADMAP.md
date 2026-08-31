# CoachTrack Pro — Roadmap (living document)

**Goal:** grow CoachTrack into a **full academy ERP** for **Pakistani coaching centers and schools**, implemented **one phase at a time** (not all at once). This file is the running plan; update it as phases ship.

Market research behind these choices: **[REQUIREMENTS-GAP-ANALYSIS.md](REQUIREMENTS-GAP-ANALYSIS.md)**.

---

## ✅ Shipped (as of 2026-08-24)

PKR + local payment methods · multi-tenant SaaS (entities, branches, isolated data) · roles/RBAC + user & branch management · super-admin console + impersonation · students · courses/batches · fee components · vouchers/collections (installments, late fees, exam fee, transactional payments) · enrollments/transfers · admissions CRM · expenses/P&L · dashboard/reports · audit log · **CSV/XLSX bulk import** · reminder rule/template engine + queue preview *(sending not wired — see below)*.

## 🎯 Now — UI quality pass (in progress)

The app works but the UI needs structure/polish. Starting with the **super-admin console** (rebuild to match the app's design system), then general consistency (page headers, empty states, spacing, the `/users` branch-assignment field, mobile).

---

## Cost note that steers ordering: WhatsApp & SMS are **not** free

- **WhatsApp Business API (automated/bulk):** paid per template message (utility ≈ Rs 2–4; marketing more) + requires Meta Business verification and a paid provider (BSP). **Deferred** until there's willingness to pay per message.
- **Bulk SMS:** paid (~Rs 1–2/SMS via a gateway + PTA sender-ID). **Deferred.**
- **✅ Free path we WILL build:** **`wa.me` click-to-send links** — generate a pre-filled Urdu/Roman-Urdu reminder/receipt message; staff clicks and sends from their own WhatsApp (no API, no per-message cost). Same "reach the parent" value, free to operate.

---

## Phased plan (implement one at a time)

### Phase A — Fee-collection wedge (free to operate, highest ROI)
- **A1. Free WhatsApp reminders/receipts via `wa.me` links** — from the reminder queue + on payment, one-click "Send on WhatsApp" opening a pre-filled message. Urdu templates ("Assalam-o-Alaikum {ParentName}…").
- **A2. Printable fee challan / voucher (PDF)** — bank-challan format, multi-copy (bank/office/student), voucher-no barcode for over-the-counter bank payment. (Print/PDF only — free.)
- *(Later, paid) A3. Online payment gateway (JazzCash/Easypaisa/Raast/KuickPay) with auto-reconciliation.*

### Phase B — Academic core (re-add what the market expects)
- **B1. Attendance** — daily capture + in-app/parent view; biometric (ZKTeco/RFID) CSV import hook. (Absence alert reuses A1's free WhatsApp link.)
- **B2. Tests / results** — test series, MCQ/marks, **ranked result cards** (MDCAT/ECAT/NTS prep). The defining coaching feature.
- **B3. Teacher/staff management + payroll + revenue-share** (per-student/per-batch commission).

### Phase C — Engagement (free to operate)
- **C1. Parent portal (PWA)** — parents log in to view fees, download receipts/challans, see attendance & results, announcements. "Pull" model avoids per-message cost. Needs parent auth.
- **C2. ID cards + certificates** (character/leaving certificates — legally expected in PK).

### Phase D — SaaS business layer (your revenue model)
- **D1. Subscription billing** — plans + per-plan limits (students, message credits), invoices for the institutes *you* onboard. Currently absent although the app is already multi-tenant.
- **D2. Entity onboarding wizard** — guided setup for a new institute (branches → courses → **import students** → fees → done), stitching the existing import feature into a flow.
- **D3. Per-entity data export/backup** (anti-lock-in trust).

### Phase E — School expansion (second market)
- **E1. Classes / sections / academic years** (schools need this backbone, not just courses+batches).
- **E2. Board result cards** (FBISE / Punjab / Sindh / KPK / Cambridge), configurable.
- **E3. Fee-regulation compliance** (e.g. Sindh 5% annual cap, separate monthly vouchers), **transport/van**, library, hostel, EMIS export.

---

## Decision log
- **2026-08-24:** WhatsApp/SMS automated sending deferred (paid). Free `wa.me` click-to-send chosen for Phase A1. UI is English-only (parent-facing *messages* may be Urdu/Roman-Urdu). Building toward full-academy-ERP one phase at a time; UI-quality pass first.
