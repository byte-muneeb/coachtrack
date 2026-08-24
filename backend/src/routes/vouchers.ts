import { Router } from "express";
import { getPool, sql, type SqlPool } from "../db";
import { logAudit } from "../audit";

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

async function nextVoucherNo(pool: SqlPool, year = new Date().getFullYear()): Promise<string> {
  const r = await pool.request()
    .input("prefix", sql.NVarChar, `VCH-${year}-%`)
    .query(
      "SELECT COALESCE(MAX(CASE WHEN regexp_replace(voucherNo,'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(voucherNo,'^.*-','')::int END),0) AS mx FROM Vouchers WHERE voucherNo LIKE @prefix"
    );
  return `VCH-${year}-${String((r.recordset[0].mx as number) + 1).padStart(4, "0")}`;
}

/**
 * Shared voucher creator (used for admission fees, exam fees, and any
 * one-off charge). Creates the voucher + its line items. `billingMonth`
 * is left null for one-time charges so they never clash with monthly generation.
 */
export async function createVoucher(
  pool: SqlPool,
  opts: {
    studentId: number; amount: number; description: string;
    billingMonth?: string | null; generateDate?: Date | null; dueDate?: Date | null; expiryDate?: Date | null;
    items?: { batchId: number | null; label: string; amount: number }[];
  }
): Promise<number> {
  const year = opts.billingMonth ? Number(opts.billingMonth.slice(0, 4)) : new Date().getFullYear();
  const voucherNo = await nextVoucherNo(pool, year);
  const vres = await pool.request()
    .input("voucherNo", sql.NVarChar, voucherNo)
    .input("studentId", sql.Int, opts.studentId)
    .input("description", sql.NVarChar, opts.description)
    .input("amount", sql.Float, opts.amount)
    .input("genDate", sql.Date, opts.generateDate || new Date())
    .input("dueDate", sql.Date, opts.dueDate || null)
    .input("expiryDate", sql.Date, opts.expiryDate || null)
    .input("month", sql.Char, opts.billingMonth || null)
    .query(`INSERT INTO dbo.Vouchers (voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, billingMonth)
            OUTPUT INSERTED.id VALUES (@voucherNo,@studentId,@description,@amount,@genDate,@dueDate,@expiryDate,@month)`);
  const vid = vres.recordset[0].id as number;
  const items = opts.items && opts.items.length ? opts.items : [{ batchId: null, label: opts.description, amount: opts.amount }];
  for (const it of items) {
    await pool.request()
      .input("vid", sql.Int, vid).input("bid", sql.Int, it.batchId)
      .input("label", sql.NVarChar, it.label).input("amt", sql.Float, it.amount)
      .query("INSERT INTO dbo.VoucherItems (voucherId, batchId, label, amount) VALUES (@vid,@bid,@label,@amt)");
  }
  return vid;
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
    const request = pool.request();
    const where: string[] = [];
    if (req.query.studentId) {
      request.input("sid", sql.Int, Number(req.query.studentId));
      where.push("v.studentId = @sid");
    }
    const status = String(req.query.status || "").trim();
    if (status && status !== "all") {
      if (status === "unpaid") {
        // "Unpaid" covers anything with a balance: unpaid OR partial.
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
    // "Search by anything": voucher #, student name, roll (registry ID), phone, description.
    const search = String(req.query.search || "").trim();
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      where.push(
        "(v.voucherNo LIKE @search OR s.fullName LIKE @search OR s.registryId LIKE @search OR s.phone LIKE @search OR v.description LIKE @search)"
      );
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const r = await request.query(`${LIST_SELECT} ${clause} ORDER BY v.createdAt DESC`);
    res.json(r.recordset);
  } catch (e) {
    next(e);
  }
});

router.get("/meta/payment-methods", (_req, res) => res.json(PAYMENT_METHODS));

// GET /api/vouchers/:id — voucher + line items + payments (drives receipt/print)
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const v = await pool.request().input("id", sql.Int, id).query(`${LIST_SELECT} WHERE v.id = @id`);
    if (!v.recordset[0]) return res.status(404).json({ error: "Voucher not found" });
    const items = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.VoucherItems WHERE voucherId = @id ORDER BY id");
    const p = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Payments WHERE voucherId = @id ORDER BY paidAt DESC");
    res.json({ ...v.recordset[0], items: items.recordset, payments: p.recordset });
  } catch (e) {
    next(e);
  }
});

// POST /api/vouchers — manual single voucher
router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const studentId = Number(b.studentId);
    if (!studentId) return res.status(400).json({ error: "studentId is required" });
    const amount = num(b.amount);
    if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    const voucherNo = await nextVoucherNo(pool);
    const r = await pool.request()
      .input("voucherNo", sql.NVarChar, voucherNo)
      .input("studentId", sql.Int, studentId)
      .input("description", sql.NVarChar, str(b.description))
      .input("amount", sql.Float, amount)
      .input("generateDate", sql.Date, toDate(b.generateDate) || new Date())
      .input("dueDate", sql.Date, toDate(b.dueDate))
      .input("expiryDate", sql.Date, toDate(b.expiryDate))
      .input("feeComponentId", sql.Int, b.feeComponentId ? Number(b.feeComponentId) : null)
      .query(`
        INSERT INTO dbo.Vouchers (voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, feeComponentId)
        OUTPUT INSERTED.*
        VALUES (@voucherNo, @studentId, @description, @amount, @generateDate, @dueDate, @expiryDate, @feeComponentId)
      `);
    // outstanding is derived from the voucher ledger on read — no counter to maintain.
    res.status(201).json(r.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 547)
      return res.status(400).json({ error: "Student does not exist" });
    next(e);
  }
});

// Core monthly generation logic — shared by the /generate route and the Vercel
// cron. Applies any due batch transfers first, then creates one combined voucher
// per student (a line item per batch) for the billing month (YYYY-MM).
export async function generateMonthlyVouchers(
  pool: SqlPool,
  opts: { billingMonth: string; generateDate?: Date | null; dueDate?: Date | null; expiryDate?: Date | null }
): Promise<{ month: string; created: number; transfersApplied: number }> {
    const month = opts.billingMonth;
    const genDate = opts.generateDate || new Date();
    const dueDate = opts.dueDate ?? null;
    const expiryDate = opts.expiryDate ?? null;

    // 1) Apply pending transfers effective this month or earlier.
    const pending = await pool.request().input("m", sql.Char, month)
      .query("SELECT * FROM dbo.Transfers WHERE status = 'pending' AND effectiveMonth <= @m");
    for (const t of pending.recordset) {
      const nb = await pool.request().input("bid", sql.Int, t.toBatchId)
        .query("SELECT id, courseId, monthlyFee FROM dbo.Batches WHERE id = @bid");
      const newBatch = nb.recordset[0];
      if (newBatch) {
        if (t.enrollmentId) {
          await pool.request()
            .input("eid", sql.Int, t.enrollmentId)
            .input("bid", sql.Int, newBatch.id)
            .input("cid", sql.Int, newBatch.courseId)
            .input("fee", sql.Float, newBatch.monthlyFee)
            .query("UPDATE dbo.Enrollments SET batchId=@bid, courseId=@cid, monthlyFee=@fee, updatedAt=SYSUTCDATETIME() WHERE id=@eid");
        } else if (t.fromBatchId) {
          await pool.request()
            .input("sid", sql.Int, t.studentId)
            .input("from", sql.Int, t.fromBatchId)
            .input("bid", sql.Int, newBatch.id)
            .input("cid", sql.Int, newBatch.courseId)
            .input("fee", sql.Float, newBatch.monthlyFee)
            .query("UPDATE dbo.Enrollments SET batchId=@bid, courseId=@cid, monthlyFee=@fee, updatedAt=SYSUTCDATETIME() WHERE studentId=@sid AND batchId=@from AND status='active'");
        }
      }
      await pool.request().input("id", sql.Int, t.id)
        .query("UPDATE dbo.Transfers SET status='applied', appliedAt=SYSUTCDATETIME() WHERE id=@id");
    }

    // 2) Students with active fee-bearing enrollments and no voucher yet this month.
    //    Pull each student's discount % and scholarship (Rs) to apply below.
    const targets = await pool.request().input("m", sql.Char, month).query(`
      SELECT e.studentId, SUM(e.monthlyFee) AS total,
             SUM(e.discount) AS discountTotal, MAX(s.scholarship) AS scholarship
      FROM dbo.Enrollments e
      JOIN dbo.Students s ON s.id = e.studentId
      WHERE e.status = 'active' AND e.monthlyFee > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.Vouchers v WHERE v.studentId = e.studentId AND v.billingMonth = @m)
      GROUP BY e.studentId
      HAVING SUM(e.monthlyFee) > 0
    `);

    const year = Number(month.slice(0, 4));
    const seq0 = await pool.request().input("prefix", sql.NVarChar, `VCH-${year}-%`)
      .query("SELECT COALESCE(MAX(CASE WHEN regexp_replace(voucherNo,'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(voucherNo,'^.*-','')::int END),0) AS mx FROM Vouchers WHERE voucherNo LIKE @prefix");
    let seq = seq0.recordset[0].mx as number;
    const monthName = new Date(year, Number(month.slice(5)) - 1, 1).toLocaleString("en-US", { month: "long" });

    let created = 0;
    for (const t of targets.recordset) {
      const gross = t.total as number;
      const discount = Math.min(t.discountTotal || 0, gross); // amount-based enrollment discounts
      const scholarship = Math.min(t.scholarship || 0, Math.max(0, gross - discount));
      const net = Math.max(0, gross - discount - scholarship);
      if (net <= 0) continue; // fully waived — nothing to bill

      seq += 1;
      const voucherNo = `VCH-${year}-${String(seq).padStart(4, "0")}`;
      const items = await pool.request().input("sid", sql.Int, t.studentId).query(`
        SELECT e.batchId, e.monthlyFee, b.name AS batchName, c.name AS courseName
        FROM dbo.Enrollments e
        LEFT JOIN dbo.Batches b ON b.id = e.batchId
        LEFT JOIN dbo.Courses c ON c.id = e.courseId
        WHERE e.studentId=@sid AND e.status='active' AND e.monthlyFee > 0
      `);
      const vres = await pool.request()
        .input("voucherNo", sql.NVarChar, voucherNo)
        .input("studentId", sql.Int, t.studentId)
        .input("description", sql.NVarChar, `Monthly Fee — ${monthName} ${year}`)
        .input("amount", sql.Float, net)
        .input("genDate", sql.Date, genDate)
        .input("dueDate", sql.Date, dueDate)
        .input("expiryDate", sql.Date, expiryDate)
        .input("month", sql.Char, month)
        .query(`INSERT INTO dbo.Vouchers (voucherNo, studentId, description, amount, generateDate, dueDate, expiryDate, billingMonth)
                OUTPUT INSERTED.id VALUES (@voucherNo,@studentId,@description,@amount,@genDate,@dueDate,@expiryDate,@month)`);
      const vid = vres.recordset[0].id as number;
      const addItem = (batchId: number | null, label: string, amount: number) =>
        pool.request().input("vid", sql.Int, vid).input("bid", sql.Int, batchId)
          .input("label", sql.NVarChar, label).input("amt", sql.Float, amount)
          .query("INSERT INTO dbo.VoucherItems (voucherId, batchId, label, amount) VALUES (@vid,@bid,@label,@amt)");
      for (const it of items.recordset) {
        const label = `${it.courseName || "Course"}${it.batchName ? " - " + it.batchName : ""}`;
        await addItem(it.batchId, label, it.monthlyFee);
      }
      if (discount > 0) await addItem(null, "Discount", -discount);
      if (scholarship > 0) await addItem(null, "Scholarship", -scholarship);
      created += 1;
    }

    return { month, created, transfersApplied: pending.recordset.length };
}

// POST /api/vouchers/generate — monthly voucher generation for ALL active enrollments.
router.post("/generate", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const month = String(b.billingMonth || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "billingMonth must be YYYY-MM" });
    const result = await generateMonthlyVouchers(pool, {
      billingMonth: month,
      generateDate: toDate(b.generateDate),
      dueDate: toDate(b.dueDate),
      expiryDate: toDate(b.expiryDate),
    });
    await logAudit(req, "generate", "vouchers", month, `${result.created} voucher(s) generated`);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/vouchers/charge-exam — charge a course's exam fee (one-time) to all
// active students enrolled in that course.
router.post("/charge-exam", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const courseId = Number(b.courseId);
    if (!courseId) return res.status(400).json({ error: "courseId is required" });
    const c = await pool.request().input("cid", sql.Int, courseId).query("SELECT name, examFee FROM dbo.Courses WHERE id=@cid");
    const course = c.recordset[0];
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!(course.examFee > 0)) return res.status(400).json({ error: "This course has no exam fee set" });
    const dueDate = toDate(b.dueDate);
    const studs = await pool.request().input("cid", sql.Int, courseId)
      .query("SELECT DISTINCT studentId FROM dbo.Enrollments WHERE courseId=@cid AND status='active'");
    let created = 0;
    for (const s of studs.recordset) {
      await createVoucher(pool, {
        studentId: s.studentId, amount: course.examFee, description: `Exam Fee — ${course.name}`,
        dueDate, items: [{ batchId: null, label: `${course.name} — Exam Fee`, amount: course.examFee }],
      });
      created += 1;
    }
    res.json({ created, course: course.name });
  } catch (e) { next(e); }
});

// POST /api/vouchers/apply-late-fees — add the configured late fee to every
// overdue, unpaid/partial voucher that hasn't been fined yet.
router.post("/apply-late-fees", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const pr = await pool.request().input("k", sql.NVarChar, "institute.profile")
      .query("SELECT settingValue FROM dbo.Settings WHERE settingKey=@k");
    let mode = "none"; let value = 0;
    try { const p = JSON.parse(pr.recordset[0]?.settingValue || "{}"); mode = p.lateFeeMode || "none"; value = Number(p.lateFeeValue) || 0; } catch { /* ignore */ }
    if (mode === "none" || value <= 0) return res.status(400).json({ error: "Late fee is not configured in Settings." });

    const overdue = await pool.request().query(`
      SELECT v.id, v.amount, v.paidAmount FROM dbo.Vouchers v
      WHERE v.status <> 'paid' AND v.dueDate IS NOT NULL AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE)
        AND NOT EXISTS (SELECT 1 FROM dbo.VoucherItems vi WHERE vi.voucherId = v.id AND vi.label LIKE 'Late Fee%')
    `);
    let applied = 0; let total = 0;
    for (const v of overdue.recordset) {
      const bal = v.amount - v.paidAmount;
      const fee = mode === "percent" ? Math.round(bal * (value / 100)) : value;
      if (fee <= 0) continue;
      await pool.request().input("vid", sql.Int, v.id)
        .input("label", sql.NVarChar, `Late Fee${mode === "percent" ? ` (${value}%)` : ""}`).input("amt", sql.Float, fee)
        .query("INSERT INTO dbo.VoucherItems (voucherId, batchId, label, amount) VALUES (@vid,NULL,@label,@amt)");
      await pool.request().input("vid", sql.Int, v.id).input("fee", sql.Float, fee)
        .query("UPDATE dbo.Vouchers SET amount = amount + @fee, status = CASE WHEN paidAmount > 0 THEN 'partial' ELSE 'unpaid' END, updatedAt=SYSUTCDATETIME() WHERE id=@vid");
      applied += 1; total += fee;
    }
    res.json({ applied, total, mode });
  } catch (e) { next(e); }
});

// POST /api/vouchers/installments — split a total into N scheduled vouchers.
router.post("/installments", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const totalAmount = num(b.totalAmount);
    const count = Math.max(1, parseInt(String(b.count), 10) || 0);
    if (!studentId || totalAmount <= 0 || !count) return res.status(400).json({ error: "studentId, totalAmount and count are required" });
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
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const s = await pool.request().input("id", sql.Int, id).query("SELECT id, fullName, registryId FROM dbo.Students WHERE id=@id");
    if (!s.recordset[0]) return res.status(404).json({ error: "Student not found" });
    const vouchers = await pool.request().input("id", sql.Int, id)
      .query("SELECT id, voucherNo, description, amount, generateDate, createdAt FROM dbo.Vouchers WHERE studentId=@id");
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
    res.json({ student: s.recordset[0], rows, totals: { billed, paid, balance: billed - paid } });
  } catch (e) { next(e); }
});

// POST /api/vouchers/:id/payments — record a payment (transactional)
router.post("/:id/payments", async (req, res, next) => {
  const pool = await getPool();
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const b = req.body || {};
  const payAmount = num(b.amount);
  if (payAmount <= 0) return res.status(400).json({ error: "Payment amount must be greater than 0" });

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const vres = await new sql.Request(tx).input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Vouchers WITH (UPDLOCK) WHERE id = @id");
    const v = vres.recordset[0];
    if (!v) { await tx.rollback(); return res.status(404).json({ error: "Voucher not found" }); }

    const remaining = v.amount - v.paidAmount;
    if (remaining <= 0) { await tx.rollback(); return res.status(400).json({ error: "Voucher already fully paid" }); }
    const applied = Math.min(payAmount, remaining);
    const newPaid = v.paidAmount + applied;
    const newStatus = newPaid >= v.amount ? "paid" : "partial";

    const payIns = await new sql.Request(tx)
      .input("voucherId", sql.Int, id)
      .input("amount", sql.Float, applied)
      .input("method", sql.NVarChar, str(b.method))
      .input("reference", sql.NVarChar, str(b.reference))
      .input("receivedBy", sql.NVarChar, str(b.receivedBy))
      .input("paidAt", sql.DateTime2, toDate(b.paidAt) || new Date())
      .query(`INSERT INTO dbo.Payments (voucherId, amount, method, reference, receivedBy, paidAt)
              OUTPUT INSERTED.* VALUES (@voucherId, @amount, @method, @reference, @receivedBy, @paidAt)`);

    await new sql.Request(tx)
      .input("id", sql.Int, id)
      .input("paid", sql.Float, newPaid)
      .input("status", sql.NVarChar, newStatus)
      .query("UPDATE dbo.Vouchers SET paidAmount=@paid, status=@status, updatedAt=SYSUTCDATETIME() WHERE id=@id");

    await tx.commit();

    const updated = await pool.request().input("id", sql.Int, id).query(`${LIST_SELECT} WHERE v.id = @id`);
    await logAudit(req, "payment", "voucher", id, `Rs ${applied} received by ${str(b.receivedBy) || "—"}`);
    // return voucher + the payment just recorded (for the receipt window)
    res.status(201).json({ ...updated.recordset[0], payment: payIns.recordset[0] });
  } catch (e) {
    try { await tx.rollback(); } catch { /* ignore */ }
    next(e);
  }
});

// DELETE /api/vouchers/:id (reverses remaining outstanding)
router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const vres = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Vouchers WHERE id = @id");
    const v = vres.recordset[0];
    if (!v) return res.status(404).json({ error: "Voucher not found" });
    // Deleting the voucher removes it from the ledger, so the derived outstanding drops automatically.
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Vouchers WHERE id = @id");
    await logAudit(req, "delete", "voucher", id, v.voucherNo);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
