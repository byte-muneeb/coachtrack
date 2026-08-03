# CoachTrack Pro — Requirements Gap Analysis & Pakistan Market-Fit Plan

**Prepared:** 2026-07-20
**Source of truth:** Stitch project `8194023143475100380` (14 screens pulled directly)
**Primary target (per decision):** Coaching / tuition centers first; schools second.

---

## 1. What CoachTrack Pro currently is (verified scope)

The 14 Stitch screens resolve to **9 real modules**:

| # | Module | Screens | What it does today |
|---|--------|---------|--------------------|
| 1 | **Executive Dashboard** | s06, s14 | Revenue MTD, outstanding fees, new registrations, collection efficiency, collection-trend chart, recent activity, quick actions |
| 2 | **Student Registration** | s02, s08 (modal) | Personal + guardian info, photo, course + batch, commencement date, discount/scholarship, installment plan, auto-generate voucher, **hardcoded 5% tax** |
| 3 | **Student Registry** | s08 | Student list, filter by course/status (Active/Pending/Graduated/Suspended), export CSV |
| 4 | **Student Profile** | s04, s05 | Profile, attendance %, overall grade, total paid, outstanding, academic history, fee history, guardian info |
| 5 | **Fee Definition** | s01, s10 | Fee components: type, frequency (monthly/quarterly/annual/one-time), amount, category, impact analysis |
| 6 | **Fee Vouchers & Collection** | s03 | Invoices, bulk voucher gen, PDF voucher, record payment (Cash / Bank Transfer / **Stripe** / Cheque) |
| 7 | **Course Configuration** | s13, s01 | Course name/code, duration, level, syllabus upload, fee mapping, **batch management + teacher assignment** |
| 8 | **Automated Fee Reminders** | s07, s09, s12 | Email / **WhatsApp Business** / SMS channels, before/on/after-due rules, template editor with variables, reminder queue |
| 9 | **Financial & Academic Reporting** | s11 | Annual revenue, outstanding, collection efficiency, enrollment growth, forecast vs actual, fee-by-course, **defaulters list + bulk reminders** |

**Verdict:** A well-designed *fee-and-finance* spine (enroll → course/batch → define fee → voucher → collect → remind → report). But it was designed against a generic/Western template. The gaps below are what stand between it and paying Pakistani customers.

---

## 2. 🔴 P0 — Localization blockers (fix these or the product is dead in Pakistan)

These are not "features"; they are the difference between a demo that closes and one that gets laughed out of the room.

1. **Currency is USD ($) everywhere.** Every amount ($450 tuition, $1,200 admission) must be **PKR (Rs)**. Real coaching fees are Rs 1,500–15,000/mo, not $450. Wrong currency = "this isn't built for us" in the first 5 seconds of a demo.

2. **Payment methods are Cash / Bank Transfer / Stripe / Cheque.** **Stripe does not operate in Pakistan.** This must be replaced with the local rails schools/centers actually use:
   - **JazzCash & Easypaisa** wallets (54M / 55M users) — table stakes.
   - **Raast** (SBP instant, QR / Request-to-Pay) — cheapest rail. *(Note: the SBP P2M merchant subsidy ran to ~June 2026 — verify current MDR status as of today.)*
   - **1Bill / 1LINK biller model** — parent pays a voucher by entering the voucher number in *any* bank/wallet app. This is how most already-digitized schools collect. Map voucher generation to the 1Bill invoice model.
   - **Bank challan paid at branch** (HBL/UBL/MCB/Meezan/Alfalah…) + **Cash** — still dominant; keep first-class.
   - Aggregators to shortcut all of the above: **KuickPay** (education specialist, on every bank app), **PayPro**, **Safepay**, **PayFast**.
   - **Auto-reconciliation:** gateway webhook → voucher auto-marked Paid → receipt auto-sent on WhatsApp. Right now payment status is manual only.

3. **Hardcoded "Tax Component (5%)" on registration.** The 5% advance tax on fees (Sec 236I) was **repealed in 2022** — do not hardcode it. Replace with **configurable provincial tax** (0% / exempt / 3% Sindh reduced), because sales tax on education is provincial and most ordinary centers pay little or none.

4. **English-only UI and templates.** Add **Urdu / bilingual** support. Reminder templates should default to Pakistani norms — open with **"Assalam-o-Alaikum {ParentName}"**, not "Hello {StudentName}". SMS in Roman Urdu halves cost (Urdu Unicode = 70 chars/segment vs 160). Urdu support is a proven local differentiator (TaleemPro, PakEduSystem).

5. **No offline / low-bandwidth mode.** Internet penetration is ~46%; load-shedding is 4–20 hrs/day; Pakistan even throttles WhatsApp/FB deliberately. A pure-cloud app is fragile here. Needs: deferred sync, lightweight Android UI, and **printable outputs** (vouchers, registers) so the front desk keeps working during outages. This is currently a desktop-software advantage you can beat.

---

## 3. 🟠 P1 — Missing must-have features for coaching centers

The current app *shows* attendance % and grades on the profile, but there is **no screen that captures them** — and the features that actually define a coaching center are absent.

6. **Attendance capture module (missing entirely).** Attendance % is displayed but there is no daily/manual/biometric attendance-taking screen. Pakistani centers expect **biometric (ZKTeco fingerprint/RFID) → auto parent WhatsApp/SMS alert on absence**. This is heavily marketed locally and a top reason parents value the app.

7. **Test / MCQ / result module (missing — this is THE coaching feature).** Grades are shown but there is no test-series or MCQ engine. Coaching centers live on **entry-test prep (MDCAT / ECAT / NTS / NUST)** — mock tests, MCQ banks, ranking, result cards. The serious Pakistani names here (Maqsad, Nearpeer, STEP/PGC) are B2C apps; a B2B management tool with a built-in test engine is genuine **white space**.

8. **Parent / student mobile app or portal (missing).** Everything today is admin-facing. Parents (on cheap Android phones) need to view fees, pay online, see attendance, see test results, and get receipts. No parent-facing surface currently exists — yet it's the #1 visible value to the end customer.

9. **Teacher payroll + revenue-share / commission (missing).** Teachers can be *assigned* to batches, but there's no payroll and no **per-student or per-batch revenue-share** — the standout gap no local B2B tool fills, and standard in Indian competitors (Classplus). Big differentiator for coaching chains and freelance-teacher academies.

10. **Multi-branch / franchise management (missing).** Labels like "Head Office" hint at it, but there's no branch switcher or central-vs-branch consolidated reporting/royalties. Coaching chains (STEP, PGC model) need this.

11. **Lead / inquiry CRM + walk-in / trial-class flow (missing).** Coaching admissions are rolling and inquiry-driven. Needs: **lead capture, follow-up pipeline, free demo/trial-class tracking, walk-in enrollment anytime** — not just a fixed "Commencement Date."

12. **Payment receipt delivery (partial).** "Record Payment" exists, but confirm an **auto receipt to parent (WhatsApp PDF / SMS)** on every payment. In Pakistan the receipt-on-WhatsApp is a trust signal.

13. **Timetable / batch scheduling with clash & room management (partial).** Batches have time slots but no real timetable, room allocation, or teacher-clash detection.

14. **Expense / petty-cash / P&L (missing).** Revenue is tracked; owners also want **expenses and profit**. Without it, "reporting" only tells half the story an owner cares about.

15. **Bulk data import / migration from Excel (missing).** The #1 first-90-days killer. Offer **one-click Excel import + free migration** or centers never leave their spreadsheets.

16. **Role-based access & staff management (partial).** Roles are name-dropped (Admin, Registrar, Director) but there's no staff/user-management or permissions screen.

17. **ID card & certificate generation (missing).** Both are common expectations; syllabus/certificate is referenced but not built.

18. **Sibling / family discounts & discount-approval workflow (partial).** Per-student discount exists; **sibling discount** (very common in PK) and an approval trail do not.

---

## 4. 🟡 P2 — To credibly serve *schools* too (your second market)

The current design is coaching-shaped (courses + batches). Schools need a different backbone. To sell into schools later, add:

19. **Classes / sections / academic years** (not just courses + batches).
20. **Board-format result cards & report cards** — configurable per board (FBISE / Punjab / Sindh / KPK / Balochistan / Cambridge). Support marks+% *and* the new FBISE grade-only GPA scheme. Free result-card customization to the board is a standard deal-closer locally.
21. **Fee-regulation compliance features** — e.g. Sindh's **5% annual increase cap**, **separate monthly vouchers** (no lump-sum), and no charges during board-exam months.
22. **Transport (routes + GPS), hostel, library, and staff HR/payroll** — the standard school-ERP ladder.
23. **Annual school census / EMIS export** for provincial reporting.

---

## 5. 🟢 Go-to-market requirements (so it actually *gets users*)

Features alone don't win this market. Bake these in:

- **Pricing that clears the cost objection.** Budget schools/centers have razor-thin margins. Offer a **genuine free tier (≤50–100 students)** as the funnel, then **low flat monthly tiers** (owners fear per-student pricing at scale — a 1,000-student center at Rs 30 = Rs 30,000/mo scares them). Competitors anchor at Rs 8,000/**year** flat and even "lifetime" desktop copies — price against that reality.
- **The wedge to lead every demo with:** *fee collection + automated WhatsApp reminders*. That's the visible, revenue-linked win that flips a center off paper/Excel. You already have the reminder screen — make the collection side local and it's your hook.
- **Trust builders:** local Urdu/English support, **free on-site training**, free trial **on the center's own data**, reference-logo wall, and native wallet + WhatsApp integration shown live.
- **Distribution:** owner is usually the sole decision-maker → short demo-led SMB motion, Facebook marketing, and a **reseller/agent program** (local rivals pay ~10% recurring).
- **WhatsApp cost awareness:** Meta bills per message (Utility ~Rs 2.79, free within 24h service window). Design reminders to prefer Utility templates + free-window replies, with SMS (Roman Urdu) as the reach floor.

---

## 6. Prioritized action list

**Do first (P0 — market entry):**
1. USD → PKR everywhere.
2. Replace Stripe/cheque-centric payments with JazzCash + Easypaisa + Raast + 1Bill/challan + a gateway (KuickPay/PayPro) with auto-reconciliation.
3. Make tax configurable (kill hardcoded 5%).
4. Urdu/bilingual UI + Pakistani reminder templates.
5. Auto WhatsApp/SMS receipt on payment.

**Do next (P1 — coaching differentiation):**
6. Attendance capture (+ biometric hook + absence alert).
7. Parent mobile app/portal (fees, pay, attendance, results, receipts).
8. Test/MCQ + result module (entry-test prep).
9. Teacher payroll + revenue-share.
10. Lead/inquiry CRM + walk-in/trial flow.
11. Excel import/migration.
12. Multi-branch; expenses/P&L; RBAC & staff mgmt; timetable; ID cards/certificates; sibling discounts.

**Later (P2 — school expansion):**
13. Classes/sections, board result cards, fee-cap compliance, transport/hostel/library, EMIS export.

---

### Open questions to confirm before building
- Confirm current Raast P2M MDR/subsidy status (subsidy window was ~Sep 2025–Jun 2026).
- Which board result formats matter most for your school targets?
- Free-tier ceiling and flat-tier price points you want to anchor on.
- Do you want the parent app as PWA (cheap, offline-friendly) or native Android?
