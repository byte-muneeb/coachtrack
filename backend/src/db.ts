// Postgres (Supabase) data layer.
//
// The app was originally written against SQL Server (mssql). Rather than rewrite
// every query, this module exposes the SAME tiny surface the routes already use
// — `getPool()`, `pool.request().input(name, type, value).query(sql)` returning
// `{ recordset, rowsAffected }`, plus `sql.Transaction` / `sql.Request` — but
// backed by `pg`. A small translate() step rewrites the mechanical T-SQL-isms
// (named params, dbo. schema, SYSUTCDATETIME/ISNULL, OUTPUT INSERTED, TOP,
// UPDLOCK) to Postgres. T-SQL-only constructs (DECLARE batches, MERGE,
// PARSENAME, DATEADD/FORMAT) were rewritten by hand in the individual routes.
//
// The mssql version is preserved in _backups/coachtrack-mssql-backend-backup.zip.
import "dotenv/config";
import { Pool, types } from "pg";
import type { PoolClient } from "pg";
import { hashPassword } from "./auth";

// --- Type parsers: keep JS types matching what the mssql driver returned. ---
// bigint (COUNT(*)) and numeric come back as strings by default in pg → coerce
// to numbers so `=== 0` comparisons and arithmetic keep working. DATE comes back
// as a plain 'YYYY-MM-DD' string (no timezone shift), matching the frontend's
// `string | null` expectations.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8 / bigint
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(1082, (v) => v); // date → raw string

// --- Connection ------------------------------------------------------------
// Supabase gives a single connection string; use DATABASE_URL. For local dev
// against a plain Postgres you can instead set PGHOST/PGPORT/PGDATABASE/PGUSER/
// PGPASSWORD. SSL is on by default (Supabase requires it); set PGSSL=disable to
// turn it off for a local, non-SSL Postgres.
const sslOpt = process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false };

let pgPool: Pool | null = null;
function pg(): Pool {
  if (!pgPool) {
    pgPool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslOpt, max: 10, idleTimeoutMillis: 30000 })
      : new Pool({
          host: process.env.PGHOST || process.env.DB_SERVER || "localhost",
          port: Number(process.env.PGPORT || process.env.DB_PORT) || 5432,
          database: process.env.PGDATABASE || process.env.DB_NAME || "postgres",
          user: process.env.PGUSER || process.env.DB_USER || "postgres",
          password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
          ssl: sslOpt,
          max: 10,
          idleTimeoutMillis: 30000,
        });
  }
  return pgPool;
}

// --- Result key remap: Postgres folds unquoted identifiers to lowercase, so a
// `SELECT registryId` comes back as `registryid`. The routes read camelCase
// properties, so map every known lowercase column/alias back to its camelCase.
const CAMEL = [
  "registryId", "fullName", "dateOfBirth", "guardianName", "guardianRelation", "photoUrl",
  "commencementDate", "discountPct", "totalFee", "createdAt", "updatedAt", "branchId",
  "durationMonths", "admissionFee", "monthlyFee", "examFee", "courseId", "timeSlot",
  "startDate", "endDate", "voucherNo", "studentId", "paidAmount", "generateDate", "dueDate",
  "expiryDate", "billingMonth", "feeComponentId", "voucherId", "batchId", "receivedBy",
  "paidAt", "enrollmentId", "fromBatchId", "toBatchId", "effectiveMonth", "appliedAt",
  "paidVia", "interestedCourse", "trialDate", "followUpDate", "convertedStudentId",
  "offsetType", "offsetDays", "settingKey", "settingValue", "passwordHash", "userId", "entityId",
  // multi-tenant additions
  "contactPhone", "contactEmail", "isPrimary", "impersonatorId", "targetType", "targetId",
  "entityName", "branchName", "branchIds", "studentCount", "userCount",
  // attendance
  "markedBy", "presentCount", "absentCount", "lateCount", "leaveCount", "totalMarked", "attendancePct",
  // computed SELECT aliases
  "batchCount", "batchName", "batchStatus", "batchTimeSlot", "courseName", "discountTotal",
  "fromBatchName", "isOverdue", "newRegistrationsMTD", "outstandingLive", "outstandingStudentsCount",
  "overdueCount", "overdueVouchers", "revenueMTD", "selectedMonth", "studentName", "studentPhone",
  "studentRegistryId", "studentsCount", "toBatchName", "totalCollected", "totalExpenses",
  "totalIncome", "totalOutstanding", "totalStudents",
];
const KEY_MAP: Record<string, string> = {};
for (const c of CAMEL) KEY_MAP[c.toLowerCase()] = c;

function remapRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const k in row) out[KEY_MAP[k] ?? k] = row[k];
  return out as T;
}

// --- SQL dialect translation (mechanical T-SQL → Postgres) -----------------
// Exported for unit testing; not part of the public data API.
export function translate(sqlText: string): { text: string; order: string[] } {
  let t = sqlText;
  t = t.replace(/\bdbo\./gi, "");
  t = t.replace(/SYSUTCDATETIME\(\)/gi, "now()");
  t = t.replace(/GETUTCDATE\(\)/gi, "now()");
  t = t.replace(/GETDATE\(\)/gi, "now()");
  t = t.replace(/\bISNULL\s*\(/gi, "COALESCE(");

  // WITH (UPDLOCK) row-lock hint → trailing FOR UPDATE
  let forUpdate = false;
  if (/WITH\s*\(\s*UPDLOCK[^)]*\)/i.test(t)) {
    forUpdate = true;
    t = t.replace(/WITH\s*\(\s*UPDLOCK[^)]*\)/gi, "");
  }

  // OUTPUT INSERTED.x, INSERTED.y ...  → trailing RETURNING x, y  (INSERT/UPDATE)
  let returning = "";
  const out = t.match(/OUTPUT\s+(INSERTED\.\*|INSERTED\.\w+(?:\s*,\s*INSERTED\.\w+)*)/i);
  if (out) {
    returning = " RETURNING " + out[1].replace(/INSERTED\./gi, "");
    t = t.replace(out[0], "");
  }

  // SELECT TOP n  → trailing LIMIT n
  let limit = "";
  const top = t.match(/SELECT\s+TOP\s*\(?\s*(\d+)\s*\)?\s+/i);
  if (top) {
    limit = " LIMIT " + top[1];
    t = t.replace(top[0], "SELECT ");
  }

  t = t.replace(/;\s*$/, "").replace(/\s+$/, "");
  if (limit) t += limit;
  if (forUpdate) t += " FOR UPDATE";
  if (returning) t += returning;

  // @named → $n positional (reusing the same index for a repeated name)
  const order: string[] = [];
  t = t.replace(/@(\w+)/g, (_m, name: string) => {
    let idx = order.indexOf(name);
    if (idx === -1) { order.push(name); idx = order.length - 1; }
    return "$" + (idx + 1);
  });

  return { text: t, order };
}

function mapError(err: unknown): void {
  const e = err as { code?: string; number?: number };
  if (e && e.code === "23505") e.number = 2627; // unique violation  (T-SQL 2627)
  else if (e && e.code === "23503") e.number = 547; // FK violation    (T-SQL 547)
}

// --- Request / Transaction shim -------------------------------------------
type Exec = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

class Request {
  private params: Record<string, unknown> = {};
  private exec: Exec;
  constructor(ctx: Pool | Transaction) {
    this.exec = ctx instanceof Transaction ? (ctx.client as unknown as Exec) : (ctx as unknown as Exec);
  }
  input(name: string, a?: unknown, b?: unknown): this {
    let value = arguments.length >= 3 ? b : a;
    if (typeof value === "boolean") value = value ? 1 : 0; // BIT columns are SMALLINT
    this.params[name] = value;
    return this;
  }
  // Default T is `any` to match the mssql driver's permissive recordset typing,
  // so existing `row.field` arithmetic keeps compiling.
  async query<T = any>(text: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    const { text: t, order } = translate(text);
    try {
      const res = order.length
        ? await this.exec.query(t, order.map((n) => this.params[n]))
        : await this.exec.query(t);
      return { recordset: res.rows.map(remapRow) as T[], rowsAffected: [res.rowCount ?? 0] };
    } catch (err) {
      mapError(err);
      throw err;
    }
  }
}

class Transaction {
  client: PoolClient | null = null;
  constructor(private wrapped: Pool) {}
  async begin(): Promise<void> {
    this.client = await this.wrapped.connect();
    await this.client.query("BEGIN");
  }
  async commit(): Promise<void> {
    if (!this.client) return;
    await this.client.query("COMMIT");
    this.client.release();
    this.client = null;
  }
  async rollback(): Promise<void> {
    if (!this.client) return;
    await this.client.query("ROLLBACK");
    this.client.release();
    this.client = null;
  }
}

// Type alias so routes can annotate a request object (mssql exposed `sql.Request`
// as a type; here it's a value, so expose the instance type separately).
export type SqlRequest = Request;

// Pool wrapper exposing the mssql-style `.request()` the routes call.
class PoolWrapper {
  constructor(public pgPool: Pool) {}
  request(): Request {
    return new Request(this.pgPool);
  }
}

// Type alias for the pool object (mssql exposed `sql.ConnectionPool` as a type).
export type SqlPool = PoolWrapper;

let poolPromise: Promise<PoolWrapper> | null = null;
export function getPool(): Promise<PoolWrapper> {
  if (!poolPromise) {
    poolPromise = Promise.resolve(new PoolWrapper(pg())).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// `sql` namespace the routes import: type markers are no-ops (pg infers types),
// while Transaction/Request are the real shim classes. `new sql.Transaction(pool)`
// is called with the PoolWrapper, whose underlying pg Pool the Transaction uses.
export const sql = {
  Int: "int", BigInt: "bigint", Float: "float", Bit: "bit", Char: "char",
  NVarChar: "nvarchar", VarChar: "varchar", Text: "text",
  Date: "date", DateTime: "datetime", DateTime2: "datetime2", MAX: "max",
  Request: Request as unknown as new (ctx: PoolWrapper | Transaction) => Request,
  Transaction: (class {
    constructor(pool: PoolWrapper) {
      return new Transaction(pool.pgPool);
    }
  }) as unknown as new (pool: PoolWrapper) => Transaction,
};

// ===========================================================================
// Multi-tenant schema.
//
// Isolation model (see MULTI-TENANCY-REQUIREMENTS.md): every operational table
// carries `entityId` (the tenant / coaching center). Branch-scoped tables also
// carry `branchId`. Reads are filtered by entityId (+ branch set for branch
// roles) and writes stamp both from the request's tenant context — enforced in
// the routes, never from client input.
//
// ensureSchema is CREATE-IF-NOT-EXISTS and assumes a clean database. When moving
// an existing single-tenant DB to this schema, run the reset in seed.ts first
// (it drops the old tables so this rebuilds them fresh).
// ===========================================================================
export async function ensureSchema(): Promise<void> {
  const pool = await getPool();
  const run = (q: string) => pool.request().query(q);

  // Retired modules (Tests, Teacher Payroll): drop legacy tables.
  // NOTE: Attendance is an ACTIVE table (created below) — it must NOT be dropped
  // here, or every serverless cold start would erase all attendance data.
  await run(`DROP TABLE IF EXISTS TestResults, Tests, Teachers CASCADE;`);

  // --- Tenancy backbone ---
  await run(`
    CREATE TABLE IF NOT EXISTS Entities (
      id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE,
      status       TEXT NOT NULL DEFAULT 'active',   -- active | suspended | deleted
      contactPhone TEXT,
      contactEmail TEXT,
      createdAt    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Branches (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId  INT NOT NULL,
      name      TEXT NOT NULL,
      city      TEXT,
      address   TEXT,
      phone     TEXT,
      manager   TEXT,
      isPrimary SMALLINT NOT NULL DEFAULT 0,
      status    TEXT NOT NULL DEFAULT 'active',
      createdAt TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Branches_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Users (
      id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId     INT,                              -- NULL only for super_admin
      username     TEXT NOT NULL UNIQUE,             -- globally unique login id
      passwordHash TEXT NOT NULL,
      fullName     TEXT,
      role         TEXT NOT NULL DEFAULT 'entity_admin',
      status       TEXT NOT NULL DEFAULT 'active',
      createdAt    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Users_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE
    );`);

  // Branch set for branch-scoped users (entity_admin implicitly has all branches).
  await run(`
    CREATE TABLE IF NOT EXISTS UserBranches (
      userId   INT NOT NULL,
      branchId INT NOT NULL,
      PRIMARY KEY (userId, branchId),
      CONSTRAINT FK_UB_Users    FOREIGN KEY (userId)   REFERENCES Users(id)    ON DELETE CASCADE,
      CONSTRAINT FK_UB_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  // --- Operational tables (all carry entityId; branch-level ones carry branchId) ---
  await run(`
    CREATE TABLE IF NOT EXISTS Courses (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId       INT NOT NULL,
      branchId       INT NOT NULL,
      name           TEXT NOT NULL,
      code           TEXT,
      level          TEXT,
      durationMonths INT,
      description    TEXT,
      admissionFee   DOUBLE PRECISION NOT NULL DEFAULT 0,
      monthlyFee     DOUBLE PRECISION NOT NULL DEFAULT 0,
      examFee        DOUBLE PRECISION NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'active',
      createdAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Courses_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Courses_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Batches (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId   INT NOT NULL,
      branchId   INT NOT NULL,
      courseId   INT NOT NULL,
      name       TEXT NOT NULL,
      timeSlot   TEXT,
      teacher    TEXT,
      startDate  DATE,
      endDate    DATE,
      monthlyFee DOUBLE PRECISION NOT NULL DEFAULT 0,
      capacity   INT,
      status     TEXT NOT NULL DEFAULT 'active',
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Batches_Courses  FOREIGN KEY (courseId) REFERENCES Courses(id)  ON DELETE CASCADE,
      CONSTRAINT FK_Batches_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Batches_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS FeeComponents (
      id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId    INT NOT NULL,
      branchId    INT NOT NULL,
      name        TEXT NOT NULL,
      category    TEXT,
      frequency   TEXT,
      amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      createdAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Fees_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Fees_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Students (
      id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId         INT NOT NULL,
      branchId         INT NOT NULL,
      registryId       TEXT NOT NULL,
      fullName         TEXT NOT NULL,
      email            TEXT,
      phone            TEXT,
      dateOfBirth      DATE,
      address          TEXT,
      guardianName     TEXT,
      guardianRelation TEXT,
      photoUrl         TEXT,
      course           TEXT,
      batch            TEXT,
      commencementDate DATE,
      status           TEXT NOT NULL DEFAULT 'active',
      discountPct      DOUBLE PRECISION NOT NULL DEFAULT 0,
      scholarship      DOUBLE PRECISION NOT NULL DEFAULT 0,
      totalFee         DOUBLE PRECISION NOT NULL DEFAULT 0,
      outstanding      DOUBLE PRECISION NOT NULL DEFAULT 0,
      notes            TEXT,
      createdAt        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Students_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Students_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE,
      CONSTRAINT UQ_Students_registry UNIQUE (entityId, registryId)
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Vouchers (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId       INT NOT NULL,
      branchId       INT NOT NULL,
      voucherNo      TEXT NOT NULL,
      studentId      INT NOT NULL,
      description    TEXT,
      amount         DOUBLE PRECISION NOT NULL DEFAULT 0,
      paidAmount     DOUBLE PRECISION NOT NULL DEFAULT 0,
      generateDate   DATE,
      dueDate        DATE,
      expiryDate     DATE,
      billingMonth   CHAR(7),
      status         TEXT NOT NULL DEFAULT 'unpaid',
      feeComponentId INT,
      createdAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Vouchers_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Vouchers_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Vouchers_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE,
      CONSTRAINT UQ_Vouchers_no UNIQUE (entityId, voucherNo)
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS VoucherItems (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId  INT NOT NULL,
      voucherId INT NOT NULL,
      batchId   INT,
      label     TEXT,
      amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT FK_VoucherItems_Vouchers FOREIGN KEY (voucherId) REFERENCES Vouchers(id) ON DELETE CASCADE,
      CONSTRAINT FK_VoucherItems_Entities FOREIGN KEY (entityId)  REFERENCES Entities(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Payments (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId   INT NOT NULL,
      branchId   INT NOT NULL,
      voucherId  INT NOT NULL,
      amount     DOUBLE PRECISION NOT NULL,
      method     TEXT,
      reference  TEXT,
      receivedBy TEXT,
      paidAt     TIMESTAMPTZ NOT NULL DEFAULT now(),
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Payments_Vouchers FOREIGN KEY (voucherId) REFERENCES Vouchers(id) ON DELETE CASCADE,
      CONSTRAINT FK_Payments_Entities FOREIGN KEY (entityId)  REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Payments_Branches FOREIGN KEY (branchId)  REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Enrollments (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId   INT NOT NULL,
      branchId   INT NOT NULL,
      studentId  INT NOT NULL,
      batchId    INT NOT NULL,
      courseId   INT,
      monthlyFee DOUBLE PRECISION NOT NULL DEFAULT 0,
      discount   DOUBLE PRECISION NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'active',
      startDate  DATE,
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Enrollments_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Enrollments_Batches  FOREIGN KEY (batchId)   REFERENCES Batches(id),
      CONSTRAINT FK_Enrollments_Entities FOREIGN KEY (entityId)  REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Enrollments_Branches FOREIGN KEY (branchId)  REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Transfers (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId       INT NOT NULL,
      branchId       INT NOT NULL,
      studentId      INT NOT NULL,
      enrollmentId   INT,
      fromBatchId    INT,
      toBatchId      INT NOT NULL,
      reason         TEXT,
      effectiveMonth CHAR(7) NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      createdAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      appliedAt      TIMESTAMPTZ,
      CONSTRAINT FK_Transfers_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Transfers_Entities FOREIGN KEY (entityId)  REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Transfers_Branches FOREIGN KEY (branchId)  REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Expenses (
      id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId    INT NOT NULL,
      branchId    INT NOT NULL,
      date        DATE NOT NULL,
      category    TEXT,
      description TEXT,
      amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
      paidVia     TEXT,
      createdAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Expenses_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Expenses_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Inquiries (
      id                 INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId           INT NOT NULL,
      branchId           INT NOT NULL,
      name               TEXT NOT NULL,
      phone              TEXT,
      email              TEXT,
      interestedCourse   TEXT,
      source             TEXT,
      stage              TEXT NOT NULL DEFAULT 'new',
      trialDate          DATE,
      followUpDate       DATE,
      notes              TEXT,
      convertedStudentId INT,
      createdAt          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt          TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Inquiries_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Inquiries_Branches FOREIGN KEY (branchId) REFERENCES Branches(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Attendance (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId  INT NOT NULL,
      branchId  INT NOT NULL,
      studentId INT NOT NULL,
      date      DATE NOT NULL,
      status    TEXT NOT NULL DEFAULT 'present',   -- present | absent | late | leave
      note      TEXT,
      markedBy  INT,
      createdAt TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Attendance_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Attendance_Entities FOREIGN KEY (entityId)  REFERENCES Entities(id) ON DELETE CASCADE,
      CONSTRAINT FK_Attendance_Branches FOREIGN KEY (branchId)  REFERENCES Branches(id) ON DELETE CASCADE,
      CONSTRAINT UQ_Attendance UNIQUE (studentId, date)
    );`);

  // --- Entity-wide config (no branch dimension) ---
  await run(`
    CREATE TABLE IF NOT EXISTS ReminderRules (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId   INT NOT NULL,
      offsetType TEXT NOT NULL DEFAULT 'before',
      offsetDays INT  NOT NULL DEFAULT 0,
      channels   TEXT,
      active     SMALLINT NOT NULL DEFAULT 1,
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Reminders_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Settings (
      entityId     INT NOT NULL,
      settingKey   TEXT NOT NULL,
      settingValue TEXT,
      updatedAt    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (entityId, settingKey),
      CONSTRAINT FK_Settings_Entities FOREIGN KEY (entityId) REFERENCES Entities(id) ON DELETE CASCADE
    );`);

  // AuditLog: `entityId` = tenant; the audited record is `targetType`/`targetId`
  // (renamed from the old entity/entityId columns to free up entityId for tenancy).
  // impersonatorId is set when a super_admin acted while impersonating an entity.
  await run(`
    CREATE TABLE IF NOT EXISTS AuditLog (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entityId       INT,
      branchId       INT,
      userId         INT,
      username       TEXT,
      impersonatorId INT,
      action         TEXT NOT NULL,
      targetType     TEXT,
      targetId       TEXT,
      detail         TEXT,
      createdAt      TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  // Atomic per-entity, per-year sequence backing human-readable IDs
  // (registry numbers, voucher numbers). One row per (entity, kind, year); the
  // number is handed out via a single upsert so concurrent requests can't collide.
  await run(`
    CREATE TABLE IF NOT EXISTS Counters (
      entityId INT  NOT NULL,
      kind     TEXT NOT NULL,
      year     INT  NOT NULL,
      seq      INT  NOT NULL DEFAULT 0,
      PRIMARY KEY (entityId, kind, year)
    );`);

  // --- Indexes for the isolation filters (run on every query) ---
  await run(`CREATE INDEX IF NOT EXISTS idx_students_eb    ON Students(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_courses_eb     ON Courses(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_batches_eb     ON Batches(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_fees_eb        ON FeeComponents(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_vouchers_eb    ON Vouchers(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_payments_eb    ON Payments(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_enrollments_eb ON Enrollments(entityId, branchId);`);
  // At most one ACTIVE enrollment per (student, batch) — makes the enroll guard race-proof.
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_enroll_active ON Enrollments(studentId, batchId) WHERE status='active';`);
  await run(`CREATE INDEX IF NOT EXISTS idx_expenses_eb    ON Expenses(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_inquiries_eb   ON Inquiries(entityId, branchId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_attendance_ebd ON Attendance(entityId, branchId, date);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_branches_e     ON Branches(entityId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_users_e        ON Users(entityId);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_audit_e        ON AuditLog(entityId);`);

  // Seed the platform super admin if no super_admin exists yet.
  const sa = await pool.request().query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM Users WHERE role = 'super_admin'"
  );
  if (Number(sa.recordset[0].c) === 0) {
    // ON CONFLICT keeps concurrent cold starts from racing on the seed insert.
    await pool.request()
      .input("u", sql.NVarChar, "superadmin")
      .input("p", sql.NVarChar, hashPassword("admin123"))
      .input("n", sql.NVarChar, "Platform Super Admin")
      .query("INSERT INTO Users (entityId, username, passwordHash, fullName, role, status) VALUES (NULL, @u, @p, @n, 'super_admin', 'active') ON CONFLICT (username) DO NOTHING");
    console.log("Seeded platform super admin (superadmin / admin123).");
  }
}

// Hand out the next per-entity sequence number for `kind` in `year`, atomically.
// Seeds from any pre-existing rows on first use (so legacy IDs are never reused),
// then increments purely in the Counters row. Race-proof under concurrent requests;
// a rolled-back caller simply leaves a gap, which is fine for these IDs.
export async function nextNumber(
  pool: SqlPool,
  opts: { entityId: number; kind: string; year: number; table: string; column: string; prefix: string }
): Promise<number> {
  const seed = `(SELECT COALESCE(MAX(CASE WHEN regexp_replace(${opts.column},'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(${opts.column},'^.*-','')::int END),0) FROM ${opts.table} WHERE entityId=@e AND ${opts.column} LIKE @prefix)`;
  const r = await pool.request()
    .input("e", sql.Int, opts.entityId).input("k", sql.NVarChar, opts.kind)
    .input("y", sql.Int, opts.year).input("prefix", sql.NVarChar, opts.prefix)
    .query(`INSERT INTO Counters (entityId, kind, year, seq) VALUES (@e,@k,@y, ${seed} + 1)
            ON CONFLICT (entityId, kind, year) DO UPDATE SET seq = Counters.seq + 1
            RETURNING seq`);
  return r.recordset[0].seq as number;
}

// Memoized: runs the DDL once per warm instance; a no-op after the first request.
let schemaPromise: Promise<void> | null = null;
export function ensureSchemaOnce(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = ensureSchema().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}
