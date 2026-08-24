# CoachTrack — Multi-Entity (SaaS) Requirements

**Status:** ✅ APPROVED 2026-08-24 — implementation underway (phased).

**Finalized answers (§11):** 1) global-unique username/email login. 2) every operational table is branch-tagged; entity-admin is never branch-filtered, branch-scoped users are filtered by their branch set on everything (only `Settings` + `ReminderRules` stay entity-wide config). 3) branch_manager CAN create/manage users within their branches. 4) front_desk CAN record payments. 5) impersonation = full edit, audited. 6) wipe & reseed 2 demo entities. 7) suspend + soft-delete only (no hard delete).
**Goal:** Turn CoachTrack from a single coaching-center app into a multi-tenant SaaS where one deployment serves many independent coaching centers ("entities"), each with branches and a hierarchy of users, with **strict data isolation** between entities.

Decisions you already made (locked):
- **Isolation:** app-level `entityId` on every table, centrally enforced.
- **Super admin:** can view/impersonate any entity for support, **every impersonation audited**.
- **Roles below entity-admin:** Branch manager, Accountant, Front desk, Teacher.
- **Branches:** every record belongs to a branch; **a user can be assigned to multiple branches**; entity-admin covers all branches.

---

## 1. Concepts & terminology

| Term | Meaning |
|------|---------|
| **Entity** (a.k.a. tenant) | One coaching center / institute. The unit of isolation. Created by the super admin. |
| **Branch** | A physical campus of an entity. Every operational record lives in exactly one branch. |
| **Super admin** | The software vendor (you). Global, belongs to no entity. Manages entities + can impersonate. |
| **Entity admin** | Owner/admin of one coaching center. Full access to everything in *their* entity, all branches. |
| **Branch-scoped user** | Branch manager / accountant / front desk / teacher — access limited to their **assigned set of branches**. |

## 2. Role & permission model

### 2.1 Role hierarchy
```
super_admin  (global, no entity)
  └── entity_admin        (one entity, ALL its branches — including branches created later)
        ├── branch_manager  (assigned branch set — full ops)
        ├── accountant      (assigned branch set — finance)
        ├── front_desk      (assigned branch set — admissions/students)
        └── teacher         (assigned branch set — read-mostly)
```

### 2.2 Branch assignment
- `super_admin`: not tied to any entity/branch.
- `entity_admin`: implicitly all branches of their entity (present and future). No explicit assignment rows.
- All other roles: an explicit **set of one or more branches** (`UserBranches`). They only see/act on records whose `branchId` is in their set.

### 2.3 Permission matrix (proposed — please confirm/adjust)

| Capability | super_admin | entity_admin | branch_manager | accountant | front_desk | teacher |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Manage entities (create/suspend) | ✅ | — | — | — | — | — |
| Impersonate an entity (audited) | ✅ | — | — | — | — | — |
| Manage entity settings / branding | — | ✅ | — | — | — | — |
| Create/manage branches | — | ✅ | — | — | — | — |
| Manage users (within scope) | — | ✅ (entity) | ⚠️ (branch?) | — | — | — |
| Students: create/edit | — | ✅ | ✅ | view | ✅ | view |
| Admissions / inquiries | — | ✅ | ✅ | — | ✅ | — |
| Courses / batches / fee components | — | ✅ | ✅ | view | view | view |
| Vouchers: create | — | ✅ | ✅ | ✅ | view | — |
| Payments: record | — | ✅ | ✅ | ✅ | ⚠️? | — |
| Expenses | — | ✅ | ✅ | ✅ | — | — |
| Reports / dashboard | — | ✅ | ✅ (their branches) | ✅ (their branches) | limited | — |
| Reminders config | — | ✅ | — | — | — | — |
| Audit log (their entity) | — | ✅ | — | — | — | — |

⚠️ = flagged open questions (see §11).

## 3. Data model changes

### 3.1 New tables
- **Entities**: `id, name, slug (unique), status ('active'|'suspended'), contactPhone, contactEmail, createdAt, updatedAt`. (Plan/billing fields deferred — §10.)
- **UserBranches** (join): `userId, branchId` — the branch set for branch-scoped users.

### 3.2 Users table (extend)
Add: `entityId` (NULL only for super_admin), `role` (enum: `super_admin|entity_admin|branch_manager|accountant|front_desk|teacher`), keep `status`.
Login identity: **globally-unique username/email** (recommended — see §11 Q1); `entityId` is read from the user's row after login, so no "which entity?" prompt is needed.

### 3.3 `entityId` / `branchId` on existing tables
Every operational table gets **`entityId` (NOT NULL)**. Tables that are branch-specific also get **`branchId`**.

**Proposed split (confirm in §11 Q2):**
- **Entity-level (entityId only, shared across branches):** `Courses`, `FeeComponents`, `ReminderRules`, `Settings`, `Branches`.
- **Branch-level (entityId + branchId):** `Students`, `Batches`, `Enrollments`, `Vouchers`, `Payments`, `Expenses`, `Inquiries`, `Transfers`, `VoucherItems` (inherits via voucher), `AuditLog`.

### 3.4 Uniqueness & sequences (important — these are global today)
- `registryId` (e.g. `CT-2026-0001`) and `voucherNo`: become **unique per entity**, and the `MAX+1` numbering is **scoped per entity**. Prefix comes from that entity's settings.
- `Settings.settingKey`: primary key becomes composite **`(entityId, settingKey)`**.
- `Entities.slug`: globally unique.
- Username/email: globally unique (per §11 Q1).

### 3.5 Indexes
Add indexes on `entityId` and composite `(entityId, branchId)` for the branch-level tables (isolation filters run on every query).

## 4. Authentication & session changes

- **Token payload** becomes: `{ userId, entityId (null for super_admin), role, exp, impersonatorId? }`.
  - Branch set is **not** in the token (can grow/change); it's loaded per request from `UserBranches` (or "all branches" for entity_admin).
- **Login:** by username/email → look up user → derive `entityId` + `role` from the row. Suspended entity ⇒ its users can't log in.
- **Super admin login:** same endpoint; `entityId = null`, `role = super_admin`.
- **Impersonation:** super admin calls `POST /api/admin/entities/:id/impersonate` → receives an entity-scoped token with `entityId` set and `impersonatorId = <superAdminId>`. Every impersonated request is tagged in the audit log. (Read-only vs editable while impersonating — §11 Q5.)

## 5. Isolation enforcement (the security core)

Because queries are hand-written SQL, we enforce isolation with a disciplined, testable pattern (not fragile string-rewriting):

1. **Tenant-context middleware** (runs after auth): resolves `req.ctx = { entityId, role, branchIds }` (branchIds = all entity branches for entity_admin).
2. **Every read** filters by `entityId = @entityId`, and branch-level reads additionally filter `branchId = ANY(@branchIds)` for branch-scoped roles.
3. **Every write** stamps `entityId` (and `branchId` for branch-level tables) from `req.ctx` — never from client input.
4. **A shared query helper / repository layer** provides the scoped request so the entityId filter is applied consistently, and code review + tests catch omissions.
5. **Automated isolation test suite** (must pass before ship): create Entity A and Entity B, then assert that A's token receives **zero** of B's rows on *every* list/detail/report endpoint, and cannot mutate B's records (404/403).
6. **Optional later hardening:** Postgres Row-Level Security as a database-level backstop.

## 6. Super-admin panel (new module)

New routes under `/api/admin/*` (super_admin only) + a super-admin UI area:
- List / search entities (with counts: users, students, status).
- **Create entity** → in one step creates: the Entity, its first **entity_admin** user (username + temp password), and a default **"Main Branch"**.
- Suspend / reactivate entity (suspended ⇒ logins blocked, data retained).
- Impersonate entity (audited) to view/support.
- (Deferred: plans, usage, billing — §10.)

## 7. Entity onboarding flow

1. Super admin creates entity + first entity_admin + Main branch (§6).
2. Entity admin logs in, changes password, sets institute profile/branding, adds branches, courses, fee components, users (assigning each user their branch set).
3. Staff log in scoped to their branches.
(Self-serve public signup is **out of scope** — entities are created by super admin only.)

## 8. Per-module impact (existing modules)

Each already-working module needs: `entityId`/`branchId` columns, scoped queries, scoped writes, and branch-set filtering for branch roles. Specifically:
- **Students / Admissions:** registry numbering per-entity; branch tagging; front-desk/branch scoping.
- **Courses / Fees:** entity-level catalog; visible to all branches of the entity.
- **Batches / Enrollments / Transfers:** branch-level.
- **Vouchers / Payments:** voucher numbering per-entity; branch-level; accountant/branch scoping.
- **Expenses / Reports / Dashboard:** all aggregates filtered by entity, and by branch set for branch-scoped users.
- **Reminders / Settings:** per-entity config (Settings key becomes per-entity).
- **Audit log:** per-entity; also records super-admin impersonation actions.

## 9. Data migration (existing deployed data)

The live DB currently holds single-tenant demo data (Ali Academy). Proposed (confirm §11 Q6):
- **Recommended:** wipe & reseed a **multi-tenant demo** — a super admin + **two** demo entities (each with branches, students, vouchers) so isolation is visibly provable.
- Alternative: wrap the existing Ali Academy data into one entity + Main branch and keep it.

## 10. Out of scope / deferred (not in this phase)

- Subscription plans, billing, usage metering / per-plan caps.
- Self-serve entity signup.
- Parent portal authentication.
- WhatsApp/SMS actual sending.
- Postgres RLS backstop (optional later).

## 11. Open questions for your verification

1. **Login identity:** globally-unique **username/email** (recommended, simplest login) — OR per-entity usernames requiring an entity code/slug at login? (Two entities each wanting username "admin" only works with the second option.)
2. **Entity-level vs branch-level split (§3.3):** confirm Courses/Fees/Reminders/Settings are entity-wide and Students/Batches/Vouchers/Payments/Expenses/Inquiries are branch-level. Anything to move?
3. **User management scope:** entity_admin manages all users in the entity (recommended). Should **branch_manager** also create/manage users within their own branches, or not?
4. **Front desk & payments:** can front_desk **record payments**, or only create/handle students & admissions?
5. **Impersonation mode:** when super admin impersonates, **read-only** or full edit (both audited)?
6. **Existing data (§9):** wipe & reseed 2 demo entities (recommended) — or migrate current demo into one entity?
7. **Entity deletion:** suspend + soft-delete only (recommended, data retained) — or allow hard delete?

## 12. Proposed implementation phases (after you approve §1–11)

1. **Schema & auth foundation:** Entities table, Users/UserBranches changes, `entityId`/`branchId` columns + indexes, per-entity uniqueness/sequences, token + login changes, tenant-context middleware.
2. **Isolation pass:** scope every existing route's reads/writes; add the automated isolation test suite (gate).
3. **Super-admin module:** entity CRUD + create-entity-admin + impersonation (audited) + super-admin UI.
4. **Entity-admin user management:** manage branches + users + branch assignment + settings/branding per entity.
5. **Frontend:** role/branch-aware nav & guards, super-admin area, branch switcher for multi-branch users.
6. **Reseed** multi-tenant demo + verify end-to-end on Supabase.

---
**Please review, answer §11, and mark anything to change. Once you approve, I'll implement phase by phase.**
