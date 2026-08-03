import "dotenv/config";
import sql from "mssql";
import { hashPassword } from "./auth";

const config: sql.config = {
  server: process.env.DB_SERVER || "localhost",
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME || "coachtrack",
  user: process.env.DB_USER || "coachtrack_app",
  password: process.env.DB_PASSWORD || "",
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

// Lazily create and reuse a single connection pool.
export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log("Connected to MS SQL:", config.database);
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export { sql };

// Idempotent schema. Each functional page adds its table(s) here.
export async function ensureSchema(): Promise<void> {
  const pool = await getPool();

  // --- Retired modules (Tests, Attendance, Teacher Payroll): drop legacy
  //     tables. Idempotent; TestResults first because of its FK to Tests. ---
  await pool.request().query(`
    IF OBJECT_ID('dbo.TestResults','U') IS NOT NULL DROP TABLE dbo.TestResults;
    IF OBJECT_ID('dbo.Tests','U')       IS NOT NULL DROP TABLE dbo.Tests;
    IF OBJECT_ID('dbo.Attendance','U')  IS NOT NULL DROP TABLE dbo.Attendance;
    IF OBJECT_ID('dbo.Teachers','U')    IS NOT NULL DROP TABLE dbo.Teachers;
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Students', 'U') IS NULL
    CREATE TABLE dbo.Students (
      id               INT IDENTITY(1,1) PRIMARY KEY,
      registryId       NVARCHAR(50)  NOT NULL UNIQUE,
      fullName         NVARCHAR(200) NOT NULL,
      email            NVARCHAR(200) NULL,
      phone            NVARCHAR(50)  NULL,
      dateOfBirth      DATE          NULL,
      address          NVARCHAR(500) NULL,
      guardianName     NVARCHAR(200) NULL,
      guardianRelation NVARCHAR(50)  NULL,
      photoUrl         NVARCHAR(1000) NULL,
      course           NVARCHAR(200) NULL,
      batch            NVARCHAR(200) NULL,
      commencementDate DATE          NULL,
      status           NVARCHAR(30)  NOT NULL CONSTRAINT DF_Students_status DEFAULT 'active',
      discountPct      FLOAT         NOT NULL CONSTRAINT DF_Students_discountPct DEFAULT 0,
      scholarship      FLOAT         NOT NULL CONSTRAINT DF_Students_scholarship DEFAULT 0,
      totalFee         FLOAT         NOT NULL CONSTRAINT DF_Students_totalFee DEFAULT 0,
      outstanding      FLOAT         NOT NULL CONSTRAINT DF_Students_outstanding DEFAULT 0,
      notes            NVARCHAR(MAX) NULL,
      createdAt        DATETIME2     NOT NULL CONSTRAINT DF_Students_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Students_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Courses', 'U') IS NULL
    CREATE TABLE dbo.Courses (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      name           NVARCHAR(200) NOT NULL,
      code           NVARCHAR(50)  NULL,
      level          NVARCHAR(50)  NULL,
      durationMonths INT           NULL,
      description    NVARCHAR(MAX) NULL,
      admissionFee   FLOAT         NOT NULL CONSTRAINT DF_Courses_admissionFee DEFAULT 0,
      monthlyFee     FLOAT         NOT NULL CONSTRAINT DF_Courses_monthlyFee DEFAULT 0,
      examFee        FLOAT         NOT NULL CONSTRAINT DF_Courses_examFee DEFAULT 0,
      status         NVARCHAR(30)  NOT NULL CONSTRAINT DF_Courses_status DEFAULT 'active',
      createdAt      DATETIME2     NOT NULL CONSTRAINT DF_Courses_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt      DATETIME2     NOT NULL CONSTRAINT DF_Courses_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Batches', 'U') IS NULL
    CREATE TABLE dbo.Batches (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      courseId  INT           NOT NULL,
      name      NVARCHAR(100) NOT NULL,
      timeSlot  NVARCHAR(100) NULL,
      teacher   NVARCHAR(200) NULL,
      startDate DATE          NULL,
      endDate   DATE          NULL,
      monthlyFee FLOAT        NOT NULL CONSTRAINT DF_Batches_monthlyFee DEFAULT 0,
      capacity  INT           NULL,
      status    NVARCHAR(30)  NOT NULL CONSTRAINT DF_Batches_status DEFAULT 'active',
      createdAt DATETIME2     NOT NULL CONSTRAINT DF_Batches_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt DATETIME2     NOT NULL CONSTRAINT DF_Batches_updatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Batches_Courses FOREIGN KEY (courseId) REFERENCES dbo.Courses(id) ON DELETE CASCADE
    );
  `);
  // Batch fee/date columns for pre-existing installs.
  await pool.request().query(`
    IF COL_LENGTH('dbo.Batches','endDate')    IS NULL ALTER TABLE dbo.Batches ADD endDate DATE NULL;
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.Batches','monthlyFee') IS NULL ALTER TABLE dbo.Batches ADD monthlyFee FLOAT NOT NULL CONSTRAINT DF_Batches_monthlyFee DEFAULT 0;
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.FeeComponents', 'U') IS NULL
    CREATE TABLE dbo.FeeComponents (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      name        NVARCHAR(200) NOT NULL,
      category    NVARCHAR(50)  NULL,
      frequency   NVARCHAR(30)  NULL,
      amount      FLOAT         NOT NULL CONSTRAINT DF_FeeComponents_amount DEFAULT 0,
      description NVARCHAR(MAX) NULL,
      status      NVARCHAR(30)  NOT NULL CONSTRAINT DF_FeeComponents_status DEFAULT 'active',
      createdAt   DATETIME2     NOT NULL CONSTRAINT DF_FeeComponents_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt   DATETIME2     NOT NULL CONSTRAINT DF_FeeComponents_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Vouchers', 'U') IS NULL
    CREATE TABLE dbo.Vouchers (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      voucherNo      NVARCHAR(50)  NOT NULL UNIQUE,
      studentId      INT           NOT NULL,
      description    NVARCHAR(300) NULL,
      amount         FLOAT         NOT NULL CONSTRAINT DF_Vouchers_amount DEFAULT 0,
      paidAmount     FLOAT         NOT NULL CONSTRAINT DF_Vouchers_paidAmount DEFAULT 0,
      generateDate   DATE          NULL,
      dueDate        DATE          NULL,
      expiryDate     DATE          NULL,
      billingMonth   CHAR(7)       NULL,
      status         NVARCHAR(20)  NOT NULL CONSTRAINT DF_Vouchers_status DEFAULT 'unpaid',
      feeComponentId INT           NULL,
      createdAt      DATETIME2     NOT NULL CONSTRAINT DF_Vouchers_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt      DATETIME2     NOT NULL CONSTRAINT DF_Vouchers_updatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Vouchers_Students FOREIGN KEY (studentId) REFERENCES dbo.Students(id) ON DELETE CASCADE
    );
  `);
  // Voucher cycle columns for pre-existing installs.
  await pool.request().query(`
    IF COL_LENGTH('dbo.Vouchers','generateDate') IS NULL ALTER TABLE dbo.Vouchers ADD generateDate DATE NULL;
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.Vouchers','expiryDate') IS NULL ALTER TABLE dbo.Vouchers ADD expiryDate DATE NULL;
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.Vouchers','billingMonth') IS NULL ALTER TABLE dbo.Vouchers ADD billingMonth CHAR(7) NULL;
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.VoucherItems', 'U') IS NULL
    CREATE TABLE dbo.VoucherItems (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      voucherId INT           NOT NULL,
      batchId   INT           NULL,
      label     NVARCHAR(300) NULL,
      amount    FLOAT         NOT NULL CONSTRAINT DF_VoucherItems_amount DEFAULT 0,
      CONSTRAINT FK_VoucherItems_Vouchers FOREIGN KEY (voucherId) REFERENCES dbo.Vouchers(id) ON DELETE CASCADE
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Payments', 'U') IS NULL
    CREATE TABLE dbo.Payments (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      voucherId  INT           NOT NULL,
      amount     FLOAT         NOT NULL,
      method     NVARCHAR(50)  NULL,
      reference  NVARCHAR(100) NULL,
      receivedBy NVARCHAR(200) NULL,
      paidAt     DATETIME2     NOT NULL CONSTRAINT DF_Payments_paidAt DEFAULT SYSUTCDATETIME(),
      createdAt  DATETIME2     NOT NULL CONSTRAINT DF_Payments_createdAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Payments_Vouchers FOREIGN KEY (voucherId) REFERENCES dbo.Vouchers(id) ON DELETE CASCADE
    );
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.Payments','receivedBy') IS NULL ALTER TABLE dbo.Payments ADD receivedBy NVARCHAR(200) NULL;
  `);

  // --- Enrollments: a student ↔ batch link (a student can be in many batches).
  //     monthlyFee is snapshotted from the batch so voucher generation is stable. ---
  await pool.request().query(`
    IF OBJECT_ID('dbo.Enrollments', 'U') IS NULL
    CREATE TABLE dbo.Enrollments (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      studentId  INT           NOT NULL,
      batchId    INT           NOT NULL,
      courseId   INT           NULL,
      monthlyFee FLOAT         NOT NULL CONSTRAINT DF_Enrollments_fee DEFAULT 0,
      status     NVARCHAR(20)  NOT NULL CONSTRAINT DF_Enrollments_status DEFAULT 'active',
      startDate  DATE          NULL,
      createdAt  DATETIME2     NOT NULL CONSTRAINT DF_Enrollments_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt  DATETIME2     NOT NULL CONSTRAINT DF_Enrollments_updatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT FK_Enrollments_Students FOREIGN KEY (studentId) REFERENCES dbo.Students(id) ON DELETE CASCADE,
      CONSTRAINT FK_Enrollments_Batches  FOREIGN KEY (batchId)   REFERENCES dbo.Batches(id)
    );
  `);
  // Per-enrollment discount (a fixed Rs amount off this batch's monthly fee).
  await pool.request().query(`IF COL_LENGTH('dbo.Enrollments','discount') IS NULL ALTER TABLE dbo.Enrollments ADD discount FLOAT NOT NULL CONSTRAINT DF_Enrollments_discount DEFAULT 0;`);

  // --- Transfers: a scheduled batch move that takes effect next month. ---
  await pool.request().query(`
    IF OBJECT_ID('dbo.Transfers', 'U') IS NULL
    CREATE TABLE dbo.Transfers (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      studentId      INT           NOT NULL,
      enrollmentId   INT           NULL,
      fromBatchId    INT           NULL,
      toBatchId      INT           NOT NULL,
      reason         NVARCHAR(500) NULL,
      effectiveMonth CHAR(7)       NOT NULL,
      status         NVARCHAR(20)  NOT NULL CONSTRAINT DF_Transfers_status DEFAULT 'pending',
      createdAt      DATETIME2     NOT NULL CONSTRAINT DF_Transfers_createdAt DEFAULT SYSUTCDATETIME(),
      appliedAt      DATETIME2     NULL,
      CONSTRAINT FK_Transfers_Students FOREIGN KEY (studentId) REFERENCES dbo.Students(id) ON DELETE CASCADE
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Expenses', 'U') IS NULL
    CREATE TABLE dbo.Expenses (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      date        DATE          NOT NULL,
      category    NVARCHAR(50)  NULL,
      description NVARCHAR(300) NULL,
      amount      FLOAT         NOT NULL CONSTRAINT DF_Expenses_amount DEFAULT 0,
      paidVia     NVARCHAR(50)  NULL,
      createdAt   DATETIME2     NOT NULL CONSTRAINT DF_Expenses_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt   DATETIME2     NOT NULL CONSTRAINT DF_Expenses_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Branches', 'U') IS NULL
    CREATE TABLE dbo.Branches (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      name      NVARCHAR(200) NOT NULL,
      city      NVARCHAR(100) NULL,
      address   NVARCHAR(300) NULL,
      phone     NVARCHAR(50)  NULL,
      manager   NVARCHAR(200) NULL,
      status    NVARCHAR(30)  NOT NULL CONSTRAINT DF_Branches_status DEFAULT 'active',
      createdAt DATETIME2     NOT NULL CONSTRAINT DF_Branches_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt DATETIME2     NOT NULL CONSTRAINT DF_Branches_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Inquiries', 'U') IS NULL
    CREATE TABLE dbo.Inquiries (
      id                 INT IDENTITY(1,1) PRIMARY KEY,
      name               NVARCHAR(200) NOT NULL,
      phone              NVARCHAR(50)  NULL,
      email              NVARCHAR(200) NULL,
      interestedCourse   NVARCHAR(200) NULL,
      source             NVARCHAR(50)  NULL,
      stage              NVARCHAR(30)  NOT NULL CONSTRAINT DF_Inquiries_stage DEFAULT 'new',
      trialDate          DATE          NULL,
      followUpDate       DATE          NULL,
      notes              NVARCHAR(MAX) NULL,
      convertedStudentId INT           NULL,
      createdAt          DATETIME2     NOT NULL CONSTRAINT DF_Inquiries_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt          DATETIME2     NOT NULL CONSTRAINT DF_Inquiries_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.ReminderRules', 'U') IS NULL
    CREATE TABLE dbo.ReminderRules (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      offsetType NVARCHAR(10)  NOT NULL CONSTRAINT DF_ReminderRules_type DEFAULT 'before', -- before | on | after
      offsetDays INT           NOT NULL CONSTRAINT DF_ReminderRules_days DEFAULT 0,
      channels   NVARCHAR(100) NULL, -- csv: whatsapp,sms,email
      active     BIT           NOT NULL CONSTRAINT DF_ReminderRules_active DEFAULT 1,
      createdAt  DATETIME2     NOT NULL CONSTRAINT DF_ReminderRules_createdAt DEFAULT SYSUTCDATETIME(),
      updatedAt  DATETIME2     NOT NULL CONSTRAINT DF_ReminderRules_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.Settings', 'U') IS NULL
    CREATE TABLE dbo.Settings (
      settingKey   NVARCHAR(100) PRIMARY KEY,
      settingValue NVARCHAR(MAX) NULL,
      updatedAt    DATETIME2     NOT NULL CONSTRAINT DF_Settings_updatedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  // Branch scoping: optional branch tag on students and courses.
  await pool.request().query(`IF COL_LENGTH('dbo.Students','branchId') IS NULL ALTER TABLE dbo.Students ADD branchId INT NULL;`);
  await pool.request().query(`IF COL_LENGTH('dbo.Courses','branchId') IS NULL ALTER TABLE dbo.Courses ADD branchId INT NULL;`);

  // Users (authentication + roles).
  await pool.request().query(`
    IF OBJECT_ID('dbo.Users', 'U') IS NULL
    CREATE TABLE dbo.Users (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      username     NVARCHAR(100) NOT NULL UNIQUE,
      passwordHash NVARCHAR(300) NOT NULL,
      fullName     NVARCHAR(200) NULL,
      role         NVARCHAR(30)  NOT NULL CONSTRAINT DF_Users_role DEFAULT 'accountant',
      status       NVARCHAR(20)  NOT NULL CONSTRAINT DF_Users_status DEFAULT 'active',
      createdAt    DATETIME2     NOT NULL CONSTRAINT DF_Users_createdAt DEFAULT SYSUTCDATETIME()
    );
  `);

  // Audit log.
  await pool.request().query(`
    IF OBJECT_ID('dbo.AuditLog', 'U') IS NULL
    CREATE TABLE dbo.AuditLog (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      userId    INT           NULL,
      username  NVARCHAR(100) NULL,
      action    NVARCHAR(50)  NOT NULL,
      entity    NVARCHAR(50)  NULL,
      entityId  NVARCHAR(50)  NULL,
      detail    NVARCHAR(500) NULL,
      createdAt DATETIME2     NOT NULL CONSTRAINT DF_AuditLog_createdAt DEFAULT SYSUTCDATETIME()
    );
  `);

  // Seed a default admin if there are no users yet.
  const uc = await pool.request().query("SELECT COUNT(*) AS c FROM dbo.Users");
  if ((uc.recordset[0].c as number) === 0) {
    await pool.request()
      .input("u", sql.NVarChar, "admin")
      .input("p", sql.NVarChar, hashPassword("admin123"))
      .input("n", sql.NVarChar, "Administrator")
      .query("INSERT INTO dbo.Users (username, passwordHash, fullName, role) VALUES (@u, @p, @n, 'admin')");
    console.log("Seeded default admin user (admin / admin123).");
  }
}

// Memoized ensureSchema — runs the DDL exactly once per process. On serverless
// (Vercel) there is no server "boot", so routes call this before touching the
// DB; after the first (cold-start) run it is a resolved-promise no-op.
let schemaPromise: Promise<void> | null = null;
export function ensureSchemaOnce(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = ensureSchema().catch((e) => {
      schemaPromise = null; // allow a retry on the next request if it failed
      throw e;
    });
  }
  return schemaPromise;
}
