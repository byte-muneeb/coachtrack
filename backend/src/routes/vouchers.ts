import { Router } from "express";
import { getPool, sql, nextNumber, type SqlPool } from "../db";
import { logAudit } from "../audit";
import { requireRole, type AuthedRequest, type TenantCtx } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";

const router = Router();

export const PAYMENT_METHODS = [
  "Cash",
  "JazzCash",
  "Easypaisa",
  "Raast",
  "Bank Transfer (IBFT)",
  "Bank Challan",
  "Cheque",
];

const canCreate = requireRole("entity_admin", "branch_manager", "accountant");
const canPay = requireRole("entity_admin", "branch_manager", "accountant", "front_desk");
const adminOnly = requireRole("entity_admin");

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// Next voucher number, scoped PER ENTITY (numbering restarts per tenant per year).
// Uses the atomic Counters sequence so concurrent requests can't produce dupes.
async function nextVoucherNo(pool: SqlPool, entityId: number, year = new Date().getFullYear()): Promise<string> {
  const seq = await nextNumber(pool, { entityId, kind: "voucher", year, table: "Vouchers", column: "voucherNo", prefix: `VCH-${year}-%` });
  return `VCH-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Shared voucher creator. Requires the owning entity + branch (a voucher belongs
 * to a student, so callers pass the student's entityId/branchId).
 */
export async function createVoucher(
  pool: SqlPool,
  opts: {
    entityId: number; branchId: number;
    studentId: number; amount: number; description: string;
    billingMonth?: string | null; generateDate?: Date | null; dueDate?: Date | null; expiryDate?: Date | null;
    items?: { batchId: number | null; label: string; amount: number }[];
  }
): Promise<number> {
  const year = opts.billingMonth ? Number(opts.billingMonth.slice(0, 4)) : new Date().getFullYear();
  const voucherNo = await nextVoucherNo(pool, opts.entityId, year);
  // The voucher and its line items must land together — one transaction.
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const vres = await new sql.Request(tx)
      .input("ent", sql.Int, opts.entityId)
      .input("branch", sql.Int, opts.branchId)
      .input("voucherNo", sql.NVarChar, voucherNo)
      .input("studentId", sql.Int, opts.studentId)
      .input("description", sql.NVarChar, opts.description)
      .input("amount", sql.Float, opts.amount)
      .input("genDate", sql.Date, opts.generateDate || new Date())
      .input("dueDate", sql.Date, opts.dueDate || null)
      .input("expiryDate", sql.Date, opts.expiryDate || null)
      .input("month", sql.Char, opts.billingMonth || null)
      .query(`INSERT INTO dbo.Vouchers (entityId, branchId, voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, billingMonth)
              OUTPUT INSERTED.id VALUES (@ent,@branch,@voucherNo,@studentId,@description,@amount,@genDate,@dueDate,@expiryDate,@month)`);
    const vid = vres.recordset[0].id as number;
    const items = opts.items && opts.items.length ? opts.items : [{ batchId: null, label: opts.description, amount: opts.amount }];
    for (const it of items) {
      await new sql.Request(tx)
        .input("ent", sql.Int, opts.entityId)
        .input("vid", sql.Int, vid).input("bid", sql.Int, it.batchId)
        .input("label", sql.NVarChar, it.label).input("amt", sql.Float, it.amount)
        .query("INSERT INTO dbo.VoucherItems (entityId, voucherId, batchId, label, amount) VALUES (@ent,@vid,@bid,@label,@amt)");
    }
    await tx.commit();
    return vid;
  } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
}

// Look up a student within scope; returns { entityId, branchId } or null.
async function studentScope(pool: SqlPool, ctx: TenantCtx, studentId: number): Promise<{ entityId: number; branchId: number } | null> {
  const s = scope(ctx);
  const r = await s.apply(pool.request()).input("sid", sql.Int, studentId)
    .query(`SELECT entityId, branchId FROM dbo.Students WHERE id=@sid ${s.clause}`);
  return r.recordset[0] ?? null;
}

// Selects voucher rows joined with student name/phone + derived overdue flag.
const LIST_SELECT = `
  SELECT v.*, s.fullName AS studentName, s.registryId AS studentRegistryId, s.phone AS studentPhone,
    CASE WHEN v.status <> 'paid' AND v.dueDate IS NOT NULL AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE)
         THEN 1 ELSE 0 END AS isOverdue
  FROM dbo.Vouchers v
  JOIN dbo.Students s ON s.id = v.studentId
`;

// GET /api/vouchers?studentId=&status=&search=&month=
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "v.entityId", branchCol: "v.branchId" });
    const request = s.apply(pool.request());
    const where: string[] = [];
    if (req.query.studentId) {
      request.input("sid", sql.Int, Number(req.query.studentId));
      where.push("v.studentId = @sid");
    }
    const status = String(req.query.status || "").trim();
    if (status && status !== "all") {
      if (status === "unpaid") {
        where.push("v.status IN ('unpaid','partial')");
      } else {
        request.input("status", sql.NVarChar, status);
        where.push("v.status = @status");
      }
    }
    const month = String(req.query.month || "").trim();
    if (/^\d{4}-\d{2}$/.test(month)) {
      request.input("month", sql.Char, month);
      where.push("v.billingMonth = @month");
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      where.push(
        "(v.voucherNo LIKE @search OR s.fullName LIKE @search OR s.registryId LIKE @search OR s.phone LIKE @search OR v.description LIKE @search)"
      );
    }
    const extra = where.length ? "AND " + where.join(" AND ") : "";
    const r = await request.query(`${LIST_SELECT} WHERE 1=1 ${s.clause} ${extra} ORDER BY v.createdAt DESC`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

router.get("/meta/payment-methods", (_req, res) => res.json(PAYMENT_METHODS));

// GET /api/vouchers/:id — voucher + line items + payments (drives receipt/print)
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "v.entityId", branchCol: "v.branchId" });
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const v = await s.apply(pool.request()).input("id", sql.Int, id).query(`${LIST_SELECT} WHERE v.id = @id ${s.clause}`);
    if (!v.recordset[0]) return res.status(404).json({ error: "Voucher not found" });
    const items = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.VoucherItems WHERE voucherId = @id ORDER BY id");
    const p = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Payments WHERE voucherId = @id ORDER BY paidAt DESC");
    res.json({ ...v.recordset[0], items: items.recordset, payments: p.recordset });
  } catch (e) { next(e); }
});

// POST /api/vouchers — manual single voucher
router.post("/", canCreate, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const studentId = Number(b.studentId);
    if (!studentId) return res.status(400).json({ error: "studentId is required" });
    const amount = num(b.amount);
    if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    const stu = await studentScope(pool, ctx, studentId);
    if (!stu) return res.status(400).json({ error: "Student does not exist" });
    const voucherNo = await nextVoucherNo(pool, stu.entityId);
    const r = await pool.request()
      .input("ent", sql.Int, stu.entityId)
      .input("branch", sql.Int, stu.branchId)
      .input("voucherNo", sql.NVarChar, voucherNo)
      .input("studentId", sql.Int, studentId)
      .input("description", sql.NVarChar, str(b.description))
      .input("amount", sql.Float, amount)
      .input("generateDate", sql.Date, toDate(b.generateDate) || new Date())
      .input("dueDate", sql.Date, toDate(b.dueDate))
      .input("expiryDate", sql.Date, toDate(b.expiryDate))
      .input("feeComponentId", sql.Int, b.feeComponentId ? Number(b.feeComponentId) : null)
      .query(`
        INSERT INTO dbo.Vouchers (entityId, branchId, voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, feeComponentId)
        OUTPUT INSERTED.*
        VALUES (@ent, @branch, @voucherNo, @studentId, @description, @amount, @generateDate, @dueDate, @expiryDate, @feeComponentId)
      `);
    res.status(201).json(r.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 547)
      return res.status(400).json({ error: "Student does not exist" });
    next(e);
  }
});

// Core monthly generation — scoped to ONE entity (each voucher inherits the
// student's branch). Called by the /generate route and by the cron per entity.
export async function generateMonthlyVouchers(
  pool: SqlPool,
  opts: {
    entityId: number; billingMonth: string; generateDate?: Date | null; dueDate?: Date | null; expiryDate?: Date | null;
    branchId?: number | null; courseId?: number | null; batchId?: number | null; studentId?: number | null; // scope filters
    feeComponentIds?: number[]; includeExamFee?: boolean;                          // add-on charges
    customItems?: { label: string; amount: number }[];                            // ad-hoc line items defined in the panel
    allowDuplicateMonth?: boolean;                                                // issue even if a voucher already exists this month
    dryRun?: boolean;                                                             // preview only, no writes
  }
): Promise<{ month: string; created: number; transfersApplied: number; totalAmount: number; breakdown: { studentId: number; studentName: string; amount: number }[] }> {
    const entityId = opts.entityId;
    const month = opts.billingMonth;
    const genDate = opts.generateDate || new Date();
    const dueDate = opts.dueDate ?? null;
    const expiryDate = opts.expiryDate ?? null;
    const dryRun = !!opts.dryRun;

    // The whole run executes in ONE transaction. On dry-run we ROLL BACK at the
    // end, so the preview reflects exactly what a real run would produce —
    // transfers applied, discounts, add-ons, custom items — without writing
    // anything. On a real run the commit makes the monthly batch atomic.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const req = () => new sql.Request(tx);
    try {
      // 1) Apply pending transfers effective this month or earlier.
      const pending = await req().input("ent", sql.Int, entityId).input("m", sql.Char, month)
        .query("SELECT * FROM dbo.Transfers WHERE entityId=@ent AND status = 'pending' AND effectiveMonth <= @m");
      for (const t of pending.recordset) {
        const nb = await req().input("ent", sql.Int, entityId).input("bid", sql.Int, t.toBatchId)
          .query("SELECT id, courseId, monthlyFee FROM dbo.Batches WHERE id = @bid AND entityId=@ent");
        const newBatch = nb.recordset[0];
        if (newBatch) {
          if (t.enrollmentId) {
            await req().input("eid", sql.Int, t.enrollmentId).input("bid", sql.Int, newBatch.id)
              .input("cid", sql.Int, newBatch.courseId).input("fee", sql.Float, newBatch.monthlyFee)
              .query("UPDATE dbo.Enrollments SET batchId=@bid, courseId=@cid, monthlyFee=@fee, updatedAt=SYSUTCDATETIME() WHERE id=@eid");
          } else if (t.fromBatchId) {
            await req().input("sid", sql.Int, t.studentId).input("from", sql.Int, t.fromBatchId)
              .input("bid", sql.Int, newBatch.id).input("cid", sql.Int, newBatch.courseId).input("fee", sql.Float, newBatch.monthlyFee)
              .query("UPDATE dbo.Enrollments SET batchId=@bid, courseId=@cid, monthlyFee=@fee, updatedAt=SYSUTCDATETIME() WHERE studentId=@sid AND batchId=@from AND status='active'");
          }
        }
        await req().input("id", sql.Int, t.id)
          .query("UPDATE dbo.Transfers SET status='applied', appliedAt=SYSUTCDATETIME() WHERE id=@id");
      }

      // Scope filters (which students to bill): branch, course/batch enrollment, or a single student.
      const scopeReq = req().input("ent", sql.Int, entityId).input("m", sql.Char, month);
      const scope: string[] = [];
      if (opts.branchId) { scopeReq.input("scBranch", sql.Int, opts.branchId); scope.push("s.branchId = @scBranch"); }
      if (opts.courseId) { scopeReq.input("scCourse", sql.Int, opts.courseId); scope.push("EXISTS (SELECT 1 FROM dbo.Enrollments e2 WHERE e2.studentId=e.studentId AND e2.status='active' AND e2.courseId=@scCourse)"); }
      if (opts.batchId) { scopeReq.input("scBatch", sql.Int, opts.batchId); scope.push("EXISTS (SELECT 1 FROM dbo.Enrollments e2 WHERE e2.studentId=e.studentId AND e2.status='active' AND e2.batchId=@scBatch)"); }
      if (opts.studentId) { scopeReq.input("scStudent", sql.Int, opts.studentId); scope.push("s.id = @scStudent"); }
      const scopeClause = scope.length ? "AND " + scope.join(" AND ") : "";
      // Bulk runs skip students already billed this month; a single one-off may override.
      const dupClause = opts.allowDuplicateMonth ? "" : "AND NOT EXISTS (SELECT 1 FROM dbo.Vouchers v WHERE v.studentId = e.studentId AND v.billingMonth = @m)";

      // 2) Students with active fee-bearing enrollments (optionally not yet billed this month).
      const targets = await scopeReq.query(`
        SELECT e.studentId, s.branchId AS branchId, MAX(s.fullName) AS studentName, SUM(e.monthlyFee) AS total,
               SUM(e.discount) AS discountTotal, MAX(s.scholarship) AS scholarship, MAX(s.discountPct) AS discountPct
        FROM dbo.Enrollments e
        JOIN dbo.Students s ON s.id = e.studentId
        WHERE e.entityId=@ent AND e.status = 'active' AND e.monthlyFee > 0
          ${dupClause}
          ${scopeClause}
        GROUP BY e.studentId, s.branchId
        HAVING SUM(e.monthlyFee) > 0
      `);

      // Resolve the chosen add-on fee components once (name + amount).
      const feeIds = (opts.feeComponentIds || []).map(Number).filter((n) => !isNaN(n));
      let addOns: { name: string; amount: number }[] = [];
      if (feeIds.length) {
        const fc = await req().input("ent", sql.Int, entityId).input("ids", sql.Int, feeIds)
          .query("SELECT name, amount FROM dbo.FeeComponents WHERE entityId=@ent AND id = ANY(@ids)");
        addOns = fc.recordset.map((x: { name: string; amount: number }) => ({ name: x.name, amount: Number(x.amount) || 0 }));
      }
      const addOnSum = addOns.reduce((a, x) => a + x.amount, 0);

      // Ad-hoc custom line items typed in the panel (applied to every billed student).
      const customItems = (opts.customItems || [])
        .map((x) => ({ label: String(x?.label || "").trim(), amount: Number(x?.amount) || 0 }))
        .filter((x) => x.label && x.amount !== 0);
      const customSum = customItems.reduce((a, x) => a + x.amount, 0);

      const year = Number(month.slice(0, 4));
      let seq = (await nextSeqStart(pool, entityId, year));
      const monthName = new Date(year, Number(month.slice(5)) - 1, 1).toLocaleString("en-US", { month: "long" });

      let created = 0, totalAmount = 0;
      const breakdown: { studentId: number; studentName: string; amount: number }[] = [];
      for (const t of targets.recordset) {
        const gross = t.total as number;
        const pctCut = Math.round((gross * (Number(t.discountPct) || 0)) / 100);
        const discount = Math.min((t.discountTotal || 0) + pctCut, gross);
        const scholarship = Math.min(t.scholarship || 0, Math.max(0, gross - discount));
        const tuitionNet = Math.max(0, gross - discount - scholarship);

        // Per-student enrollment lines (+ each course's exam fee once, if requested).
        const items = await req().input("sid", sql.Int, t.studentId).query(`
          SELECT e.batchId, e.monthlyFee, e.courseId, b.name AS batchName, c.name AS courseName, c.examFee
          FROM dbo.Enrollments e
          LEFT JOIN dbo.Batches b ON b.id = e.batchId
          LEFT JOIN dbo.Courses c ON c.id = e.courseId
          WHERE e.studentId=@sid AND e.status='active' AND e.monthlyFee > 0
        `);
        const examLines: { label: string; amount: number }[] = [];
        if (opts.includeExamFee) {
          const seen = new Set<number>();
          for (const it of items.recordset) {
            if (it.courseId && !seen.has(it.courseId) && Number(it.examFee) > 0) {
              seen.add(it.courseId); examLines.push({ label: `Exam Fee — ${it.courseName || "Course"}`, amount: Number(it.examFee) });
            }
          }
        }
        const examSum = examLines.reduce((a, x) => a + x.amount, 0);
        const amount = tuitionNet + addOnSum + examSum + customSum;
        if (amount <= 0) continue;

        created += 1; totalAmount += amount;
        breakdown.push({ studentId: t.studentId, studentName: t.studentName, amount });

        seq += 1;
        const voucherNo = `VCH-${year}-${String(seq).padStart(4, "0")}`;
        const vres = await req()
          .input("ent", sql.Int, entityId).input("branch", sql.Int, t.branchId)
          .input("voucherNo", sql.NVarChar, voucherNo).input("studentId", sql.Int, t.studentId)
          .input("description", sql.NVarChar, `Monthly Fee — ${monthName} ${year}`).input("amount", sql.Float, amount)
          .input("genDate", sql.Date, genDate).input("dueDate", sql.Date, dueDate).input("expiryDate", sql.Date, expiryDate).input("month", sql.Char, month)
          .query(`INSERT INTO dbo.Vouchers (entityId, branchId, voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, billingMonth)
                  OUTPUT INSERTED.id VALUES (@ent,@branch,@voucherNo,@studentId,@description,@amount,@genDate,@dueDate,@expiryDate,@month)`);
        const vid = vres.recordset[0].id as number;
        const addItem = (batchId: number | null, label: string, amt: number) =>
          req().input("ent", sql.Int, entityId).input("vid", sql.Int, vid).input("bid", sql.Int, batchId)
            .input("label", sql.NVarChar, label).input("amt", sql.Float, amt)
            .query("INSERT INTO dbo.VoucherItems (entityId, voucherId, batchId, label, amount) VALUES (@ent,@vid,@bid,@label,@amt)");
        for (const it of items.recordset) await addItem(it.batchId, `${it.courseName || "Course"}${it.batchName ? " - " + it.batchName : ""}`, it.monthlyFee);
        if (discount > 0) await addItem(null, "Discount", -discount);
        if (scholarship > 0) await addItem(null, "Scholarship", -scholarship);
        for (const ex of examLines) await addItem(null, ex.label, ex.amount);
        for (const ao of addOns) await addItem(null, ao.name, ao.amount);
        for (const ci of customItems) await addItem(null, ci.label, ci.amount);
      }

      if (dryRun) await tx.rollback(); else await tx.commit();
      return { month, created, transfersApplied: dryRun ? 0 : pending.recordset.length, totalAmount, breakdown };
    } catch (e) {
      try { await tx.rollback(); } catch { /* ignore */ }
      throw e;
    }
}

// Highest existing voucher sequence for an entity/year (for batch numbering).
async function nextSeqStart(pool: SqlPool, entityId: number, year: number): Promise<number> {
  const r = await pool.request().input("ent", sql.Int, entityId).input("prefix", sql.NVarChar, `VCH-${year}-%`)
    .query("SELECT COALESCE(MAX(CASE WHEN regexp_replace(voucherNo,'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(voucherNo,'^.*-','')::int END),0) AS mx FROM Vouchers WHERE entityId=@ent AND voucherNo LIKE @prefix");
  return r.recordset[0].mx as number;
}

// POST /api/vouchers/generate — monthly generation for the caller's entity.
router.post("/generate", canCreate, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const month = String(b.billingMonth || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "billingMonth must be YYYY-MM" });
    const result = await generateMonthlyVouchers(pool, {
      entityId: ctx.entityId!,
      billingMonth: month,
      generateDate: toDate(b.generateDate),
      dueDate: toDate(b.dueDate),
      expiryDate: toDate(b.expiryDate),
      branchId: b.branchId != null && b.branchId !== "" ? Number(b.branchId) : null,
      courseId: b.courseId != null && b.courseId !== "" ? Number(b.courseId) : null,
      batchId: b.batchId != null && b.batchId !== "" ? Number(b.batchId) : null,
      studentId: b.studentId != null && b.studentId !== "" ? Number(b.studentId) : null,
      feeComponentIds: Array.isArray(b.feeComponentIds) ? b.feeComponentIds : [],
      includeExamFee: !!b.includeExamFee,
      customItems: Array.isArray(b.customItems) ? b.customItems : [],
      allowDuplicateMonth: !!b.allowDuplicateMonth,
      dryRun: !!b.dryRun,
    });
    // Optionally persist the ad-hoc custom charges as reusable fee components
    // (best-effort — a failure here must not fail the generation itself).
    if (!b.dryRun && b.saveCustomToLibrary && Array.isArray(b.customItems)) {
      try {
        const branch = resolveWriteBranch(ctx, null);
        for (const raw of b.customItems) {
          const name = String(raw?.label || "").trim();
          const amount = Number(raw?.amount) || 0;
          if (!name || amount <= 0) continue;
          const exists = await pool.request().input("ent", sql.Int, ctx.entityId!).input("name", sql.NVarChar, name)
            .query("SELECT 1 FROM dbo.FeeComponents WHERE entityId=@ent AND LOWER(name)=LOWER(@name) LIMIT 1");
          if (exists.recordset.length) continue;
          await pool.request()
            .input("ent", sql.Int, ctx.entityId!).input("branch", sql.Int, branch)
            .input("name", sql.NVarChar, name).input("category", sql.NVarChar, "Other")
            .input("frequency", sql.NVarChar, "one-time").input("amount", sql.Float, amount)
            .input("description", sql.NVarChar, "Added from voucher panel").input("status", sql.NVarChar, "active")
            .query(`INSERT INTO dbo.FeeComponents (entityId, branchId, name, category, frequency, amount, description, status)
                    VALUES (@ent, @branch, @name, @category, @frequency, @amount, @description, @status)`);
        }
      } catch (e) { console.error("saveCustomToLibrary failed:", e); }
    }
    if (!b.dryRun) await logAudit(req, "generate", "vouchers", month, `${result.created} voucher(s) generated`);
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/vouchers/charge-exam — charge a course's exam fee to its active students.
router.post("/charge-exam", canCreate, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const courseId = Number(b.courseId);
    if (!courseId) return res.status(400).json({ error: "courseId is required" });
    const c = await s.apply(pool.request()).input("cid", sql.Int, courseId).query(`SELECT name, examFee FROM dbo.Courses WHERE id=@cid ${s.clause}`);
    const course = c.recordset[0];
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!(course.examFee > 0)) return res.status(400).json({ error: "This course has no exam fee set" });
    const dueDate = toDate(b.dueDate);
    const es = scope(ctx, { entityCol: "e.entityId", branchCol: "e.branchId" });
    const studs = await es.apply(pool.request()).input("cid", sql.Int, courseId)
      .query(`SELECT DISTINCT e.studentId, st.branchId FROM dbo.Enrollments e JOIN dbo.Students st ON st.id=e.studentId WHERE e.courseId=@cid AND e.status='active' ${es.clause}`);
    let created = 0;
    for (const row of studs.recordset) {
      await createVoucher(pool, {
        entityId: ctx.entityId!, branchId: row.branchId,
        studentId: row.studentId, amount: course.examFee, description: `Exam Fee — ${course.name}`,
        dueDate, items: [{ batchId: null, label: `${course.name} — Exam Fee`, amount: course.examFee }],
      });
      created += 1;
    }
    res.json({ created, course: course.name });
  } catch (e) { next(e); }
});

// POST /api/vouchers/apply-late-fees — add the configured late fee to overdue vouchers.
router.post("/apply-late-fees", adminOnly, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const s = scope(ctx, { entityCol: "v.entityId", branchCol: "v.branchId" });
    const pr = await pool.request().input("e", sql.Int, ctx.entityId).input("k", sql.NVarChar, "institute.profile")
      .query("SELECT settingValue FROM dbo.Settings WHERE entityId=@e AND settingKey=@k");
    let mode = "none"; let value = 0;
    try { const p = JSON.parse(pr.recordset[0]?.settingValue || "{}"); mode = p.lateFeeMode || "none"; value = Number(p.lateFeeValue) || 0; } catch { /* ignore */ }
    if (mode === "none" || value <= 0) return res.status(400).json({ error: "Late fee is not configured in Settings." });

    const overdue = await s.apply(pool.request()).query(`
      SELECT v.id, v.entityId, v.amount, v.paidAmount FROM dbo.Vouchers v
      WHERE v.status <> 'paid' AND v.dueDate IS NOT NULL AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE) ${s.clause}
        AND NOT EXISTS (SELECT 1 FROM dbo.VoucherItems vi WHERE vi.voucherId = v.id AND vi.label LIKE 'Late Fee%')
    `);
    let applied = 0; let total = 0;
    for (const v of overdue.recordset) {
      const bal = v.amount - v.paidAmount;
      const fee = mode === "percent" ? Math.round(bal * (value / 100)) : value;
      if (fee <= 0) continue;
      // The line item and the amount bump must land together, or a retry would be
      // skipped by the NOT EXISTS guard above and leave the voucher under-charged.
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input("ent", sql.Int, v.entityId).input("vid", sql.Int, v.id)
          .input("label", sql.NVarChar, `Late Fee${mode === "percent" ? ` (${value}%)` : ""}`).input("amt", sql.Float, fee)
          .query("INSERT INTO dbo.VoucherItems (entityId, voucherId, batchId, label, amount) VALUES (@ent,@vid,NULL,@label,@amt)");
        await new sql.Request(tx).input("vid", sql.Int, v.id).input("fee", sql.Float, fee)
          .query("UPDATE dbo.Vouchers SET amount = amount + @fee, status = CASE WHEN paidAmount > 0 THEN 'partial' ELSE 'unpaid' END, updatedAt=SYSUTCDATETIME() WHERE id=@vid");
        await tx.commit();
      } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
      applied += 1; total += fee;
    }
    res.json({ applied, total, mode });
  } catch (e) { next(e); }
});

// POST /api/vouchers/installments — split a total into N scheduled vouchers.
router.post("/installments", canCreate, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const totalAmount = num(b.totalAmount);
    const count = Math.max(1, parseInt(String(b.count), 10) || 0);
    if (!studentId || totalAmount <= 0 || !count) return res.status(400).json({ error: "studentId, totalAmount and count are required" });
    const stu = await studentScope(pool, ctx, studentId);
    if (!stu) return res.status(400).json({ error: "Student does not exist" });
    const desc = str(b.description) || "Installment Plan";
    const first = toDate(b.firstDueDate) || new Date();
    const interval = Number(b.intervalDays) || 30;
    const base = Math.floor(totalAmount / count);
    const remainder = totalAmount - base * count;
    let created = 0;
    for (let i = 0; i < count; i++) {
      const amt = base + (i === count - 1 ? remainder : 0);
      const due = new Date(first); due.setDate(due.getDate() + interval * i);
      await createVoucher(pool, {
        entityId: stu.entityId, branchId: stu.branchId,
        studentId, amount: amt, description: `${desc} (${i + 1}/${count})`, dueDate: due,
        items: [{ batchId: null, label: `${desc} — installment ${i + 1} of ${count}`, amount: amt }],
      });
      created += 1;
    }
    res.json({ created });
  } catch (e) { next(e); }
});

// GET /api/vouchers/statement/:id — full account ledger for a student.
router.get("/statement/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const st = await s.apply(pool.request()).input("id", sql.Int, id).query(`SELECT id, fullName, registryId FROM dbo.Students WHERE id=@id ${s.clause}`);
    if (!st.recordset[0]) return res.status(404).json({ error: "Student not found" });
    const vs = scope((req as AuthedRequest).ctx, { entityCol: "entityId", branchCol: "branchId" });
    const vouchers = await vs.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT id, voucherNo, description, amount, generateDate, createdAt FROM dbo.Vouchers WHERE studentId=@id ${vs.clause}`);
    const payments = await pool.request().input("id", sql.Int, id)
      .query("SELECT p.amount, p.method, p.paidAt, v.voucherNo FROM dbo.Payments p JOIN dbo.Vouchers v ON v.id=p.voucherId WHERE v.studentId=@id");
    type Row = { date: Date; type: string; ref: string; description: string; debit: number; credit: number };
    const raw: Row[] = [];
    for (const v of vouchers.recordset) raw.push({ date: v.generateDate || v.createdAt, type: "Voucher", ref: v.voucherNo, description: v.description || "Fee", debit: v.amount, credit: 0 });
    for (const p of payments.recordset) raw.push({ date: p.paidAt, type: "Payment", ref: p.voucherNo, description: `Payment (${p.method || "—"})`, debit: 0, credit: p.amount });
    raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let bal = 0;
    const rows = raw.map((r) => { bal += r.debit - r.credit; return { ...r, date: new Date(r.date).toISOString().slice(0, 10), balance: bal }; });
    const billed = vouchers.recordset.reduce((a, v) => a + v.amount, 0);
    const paid = payments.recordset.reduce((a, p) => a + p.amount, 0);
    res.json({ student: st.recordset[0], rows, totals: { billed, paid, balance: billed - paid } });
  } catch (e) { next(e); }
});

// POST /api/vouchers/:id/payments — record a payment (transactional)
router.post("/:id/payments", canPay, async (req, res, next) => {
  const pool = await getPool();
  const ctx = (req as AuthedRequest).ctx!;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const b = req.body || {};
  const payAmount = num(b.amount);
  if (payAmount <= 0) return res.status(400).json({ error: "Payment amount must be greater than 0" });

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const s = scope(ctx);
    const vres = await s.apply(new sql.Request(tx)).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Vouchers WITH (UPDLOCK) WHERE id = @id ${s.clause}`);
    const v = vres.recordset[0];
    if (!v) { await tx.rollback(); return res.status(404).json({ error: "Voucher not found" }); }

    const remaining = v.amount - v.paidAmount;
    if (remaining <= 0) { await tx.rollback(); return res.status(400).json({ error: "Voucher already fully paid" }); }
    const applied = Math.min(payAmount, remaining);
    const newPaid = v.paidAmount + applied;
    const newStatus = newPaid >= v.amount ? "paid" : "partial";

    const payIns = await new sql.Request(tx)
      .input("ent", sql.Int, v.entityId)
      .input("branch", sql.Int, v.branchId)
      .input("voucherId", sql.Int, id)
      .input("amount", sql.Float, applied)
      .input("method", sql.NVarChar, str(b.method))
      .input("reference", sql.NVarChar, str(b.reference))
      .input("receivedBy", sql.NVarChar, str(b.receivedBy))
      .input("paidAt", sql.DateTime2, toDate(b.paidAt) || new Date())
      .query(`INSERT INTO dbo.Payments (entityId, branchId, voucherId, amount, method, reference, receivedBy, paidAt)
              OUTPUT INSERTED.* VALUES (@ent, @branch, @voucherId, @amount, @method, @reference, @receivedBy, @paidAt)`);

    await new sql.Request(tx)
      .input("id", sql.Int, id)
      .input("paid", sql.Float, newPaid)
      .input("status", sql.NVarChar, newStatus)
      .query("UPDATE dbo.Vouchers SET paidAmount=@paid, status=@status, updatedAt=SYSUTCDATETIME() WHERE id=@id");

    await tx.commit();

    const us = scope(ctx, { entityCol: "v.entityId", branchCol: "v.branchId" });
    const updated = await us.apply(pool.request()).input("id", sql.Int, id).query(`${LIST_SELECT} WHERE v.id = @id ${us.clause}`);
    await logAudit(req, "payment", "voucher", id, `Rs ${applied} received by ${str(b.receivedBy) || "—"}`);
    res.status(201).json({ ...updated.recordset[0], payment: payIns.recordset[0] });
  } catch (e) {
    try { await tx.rollback(); } catch { /* ignore */ }
    next(e);
  }
});

// DELETE /api/vouchers/:id
router.delete("/:id", requireRole("entity_admin", "branch_manager"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const vres = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Vouchers WHERE id = @id ${s.clause}`);
    const v = vres.recordset[0];
    if (!v) return res.status(404).json({ error: "Voucher not found" });
    // Never destroy recorded payment history — block delete once anything is paid.
    if (Number(v.paidAmount) > 0 || v.status === "paid" || v.status === "partial")
      return res.status(409).json({ error: "This voucher has recorded payments and cannot be deleted. Cancel or adjust it instead." });
    await s.apply(pool.request()).input("id", sql.Int, id).query(`DELETE FROM dbo.Vouchers WHERE id = @id ${s.clause}`);
    await logAudit(req, "delete", "voucher", id, v.voucherNo);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
