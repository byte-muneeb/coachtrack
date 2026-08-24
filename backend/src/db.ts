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

// --- Schema (idempotent). Postgres dialect. Order respects FK dependencies. --
export async function ensureSchema(): Promise<void> {
  const pool = await getPool();
  const run = (q: string) => pool.request().query(q);

  // Retired modules (Tests, Attendance, Teacher Payroll): drop legacy tables.
  await run(`DROP TABLE IF EXISTS TestResults, Tests, Attendance, Teachers CASCADE;`);

  await run(`
    CREATE TABLE IF NOT EXISTS Students (
      id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      registryId       TEXT NOT NULL UNIQUE,
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
      updatedAt        TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Courses (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      updatedAt      TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Batches (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      CONSTRAINT FK_Batches_Courses FOREIGN KEY (courseId) REFERENCES Courses(id) ON DELETE CASCADE
    );`);
  await run(`ALTER TABLE Batches ADD COLUMN IF NOT EXISTS endDate DATE;`);
  await run(`ALTER TABLE Batches ADD COLUMN IF NOT EXISTS monthlyFee DOUBLE PRECISION NOT NULL DEFAULT 0;`);

  await run(`
    CREATE TABLE IF NOT EXISTS FeeComponents (
      id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT,
      frequency   TEXT,
      amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      createdAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt   TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Vouchers (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      voucherNo      TEXT NOT NULL UNIQUE,
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
      CONSTRAINT FK_Vouchers_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE
    );`);
  await run(`ALTER TABLE Vouchers ADD COLUMN IF NOT EXISTS generateDate DATE;`);
  await run(`ALTER TABLE Vouchers ADD COLUMN IF NOT EXISTS expiryDate DATE;`);
  await run(`ALTER TABLE Vouchers ADD COLUMN IF NOT EXISTS billingMonth CHAR(7);`);

  await run(`
    CREATE TABLE IF NOT EXISTS VoucherItems (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      voucherId INT NOT NULL,
      batchId   INT,
      label     TEXT,
      amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT FK_VoucherItems_Vouchers FOREIGN KEY (voucherId) REFERENCES Vouchers(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Payments (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      voucherId  INT NOT NULL,
      amount     DOUBLE PRECISION NOT NULL,
      method     TEXT,
      reference  TEXT,
      receivedBy TEXT,
      paidAt     TIMESTAMPTZ NOT NULL DEFAULT now(),
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Payments_Vouchers FOREIGN KEY (voucherId) REFERENCES Vouchers(id) ON DELETE CASCADE
    );`);
  await run(`ALTER TABLE Payments ADD COLUMN IF NOT EXISTS receivedBy TEXT;`);

  await run(`
    CREATE TABLE IF NOT EXISTS Enrollments (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      studentId  INT NOT NULL,
      batchId    INT NOT NULL,
      courseId   INT,
      monthlyFee DOUBLE PRECISION NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'active',
      startDate  DATE,
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT FK_Enrollments_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Enrollments_Batches  FOREIGN KEY (batchId)   REFERENCES Batches(id)
    );`);
  await run(`ALTER TABLE Enrollments ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION NOT NULL DEFAULT 0;`);

  await run(`
    CREATE TABLE IF NOT EXISTS Transfers (
      id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      studentId      INT NOT NULL,
      enrollmentId   INT,
      fromBatchId    INT,
      toBatchId      INT NOT NULL,
      reason         TEXT,
      effectiveMonth CHAR(7) NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      createdAt      TIMESTAMPTZ NOT NULL DEFAULT now(),
      appliedAt      TIMESTAMPTZ,
      CONSTRAINT FK_Transfers_Students FOREIGN KEY (studentId) REFERENCES Students(id) ON DELETE CASCADE
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Expenses (
      id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      date        DATE NOT NULL,
      category    TEXT,
      description TEXT,
      amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
      paidVia     TEXT,
      createdAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt   TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Branches (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name      TEXT NOT NULL,
      city      TEXT,
      address   TEXT,
      phone     TEXT,
      manager   TEXT,
      status    TEXT NOT NULL DEFAULT 'active',
      createdAt TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Inquiries (
      id                 INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      updatedAt          TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS ReminderRules (
      id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      offsetType TEXT NOT NULL DEFAULT 'before',
      offsetDays INT  NOT NULL DEFAULT 0,
      channels   TEXT,
      active     SMALLINT NOT NULL DEFAULT 1,
      createdAt  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updatedAt  TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS Settings (
      settingKey   TEXT PRIMARY KEY,
      settingValue TEXT,
      updatedAt    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`ALTER TABLE Students ADD COLUMN IF NOT EXISTS branchId INT;`);
  await run(`ALTER TABLE Courses  ADD COLUMN IF NOT EXISTS branchId INT;`);

  await run(`
    CREATE TABLE IF NOT EXISTS Users (
      id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      fullName     TEXT,
      role         TEXT NOT NULL DEFAULT 'accountant',
      status       TEXT NOT NULL DEFAULT 'active',
      createdAt    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await run(`
    CREATE TABLE IF NOT EXISTS AuditLog (
      id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      userId    INT,
      username  TEXT,
      action    TEXT NOT NULL,
      entity    TEXT,
      entityId  TEXT,
      detail    TEXT,
      createdAt TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  // Seed a default admin if there are no users yet.
  const uc = await pool.request().query<{ c: number }>("SELECT COUNT(*) AS c FROM Users");
  if (Number(uc.recordset[0].c) === 0) {
    await pool.request()
      .input("u", sql.NVarChar, "admin")
      .input("p", sql.NVarChar, hashPassword("admin123"))
      .input("n", sql.NVarChar, "Administrator")
      .query("INSERT INTO Users (username, passwordHash, fullName, role) VALUES (@u, @p, @n, 'admin')");
    console.log("Seeded default admin user (admin / admin123).");
  }
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
