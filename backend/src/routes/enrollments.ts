import { Router } from "express";
import { getPool, sql } from "../db";
import { createVoucher } from "./vouchers";
import { requireRole, type AuthedRequest } from "../auth";
import { scope } from "../tenant";

const router = Router();
const canWrite = requireRole("entity_admin", "branch_manager", "front_desk");

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 'yyyy-MM' for the month AFTER the current one (transfers take effect next month).
function nextMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ENROLLMENT_SELECT = `
  SELECT e.*, b.name AS batchName, b.timeSlot AS batchTimeSlot, b.status AS batchStatus,
         c.name AS courseName
  FROM dbo.Enrollments e
  LEFT JOIN dbo.Batches b ON b.id = e.batchId
  LEFT JOIN dbo.Courses c ON c.id = e.courseId
`;

// GET /api/enrollments?studentId=
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "e.entityId", branchCol: "e.branchId" });
    const studentId = Number(req.query.studentId);
    if (!studentId) return res.status(400).json({ error: "studentId is required" });
    const r = await s.apply(pool.request()).input("sid", sql.Int, studentId)
      .query(`${ENROLLMENT_SELECT} WHERE e.studentId = @sid ${s.clause} ORDER BY e.createdAt DESC`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/enrollments — enroll a student in a batch (fee snapshotted from batch)
router.post("/", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const s = scope(ctx);
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const batchId = Number(b.batchId);
    if (!studentId || !batchId) return res.status(400).json({ error: "studentId and batchId are required" });

    // Batch must be in the caller's scope; the enrollment inherits its branch.
    const bat = await s.apply(pool.request()).input("bid", sql.Int, batchId)
      .query(`SELECT id, entityId, branchId, courseId, monthlyFee FROM dbo.Batches WHERE id = @bid ${s.clause}`);
    const batch = bat.recordset[0];
    if (!batch) return res.status(400).json({ error: "Batch does not exist" });

    // Student must also be in scope.
    const stu = await s.apply(pool.request()).input("sid", sql.Int, studentId)
      .query(`SELECT id FROM dbo.Students WHERE id=@sid ${s.clause}`);
    if (!stu.recordset[0]) return res.status(400).json({ error: "Student does not exist" });

    const dup = await s.apply(pool.request()).input("sid", sql.Int, studentId).input("bid", sql.Int, batchId)
      .query(`SELECT id FROM dbo.Enrollments WHERE studentId=@sid AND batchId=@bid AND status='active' ${s.clause}`);
    if (dup.recordset[0]) return res.status(400).json({ error: "Student already enrolled in this batch" });

    const prior = await s.apply(pool.request()).input("sid", sql.Int, studentId).input("cid", sql.Int, batch.courseId)
      .query(`SELECT COUNT(*) AS c FROM dbo.Enrollments WHERE studentId=@sid AND courseId=@cid AND status='active' ${s.clause}`);
    const firstInCourse = (prior.recordset[0].c as number) === 0;

    const monthlyFee = b.monthlyFee !== undefined ? Number(b.monthlyFee) : batch.monthlyFee;
    const discount = Math.max(0, Number(b.discount) || 0);
    const r = await pool.request()
      .input("ent", sql.Int, batch.entityId)
      .input("branch", sql.Int, batch.branchId)
      .input("sid", sql.Int, studentId)
      .input("bid", sql.Int, batchId)
      .input("cid", sql.Int, batch.courseId)
      .input("fee", sql.Float, isNaN(monthlyFee) ? batch.monthlyFee : monthlyFee)
      .input("disc", sql.Float, discount)
      .input("start", sql.Date, b.startDate ? new Date(String(b.startDate)) : null)
      // ON CONFLICT makes the duplicate-active guard race-proof (unique partial index).
      .query(`INSERT INTO dbo.Enrollments (entityId, branchId, studentId, batchId, courseId, monthlyFee, discount, startDate)
              VALUES (@ent, @branch, @sid, @bid, @cid, @fee, @disc, @start)
              ON CONFLICT (studentId, batchId) WHERE status='active' DO NOTHING
              RETURNING *`);
    if (!r.recordset[0]) return res.status(400).json({ error: "Student already enrolled in this batch" });

    // Charge the course admission fee once (on the first enrollment in that course).
    // Best-effort: the enrollment is already committed, so a voucher failure must
    // not discard it — surface a warning instead of losing the enrollment.
    let warning: string | undefined;
    if (firstInCourse) {
      try {
        const cr = await s.apply(pool.request()).input("cid", sql.Int, batch.courseId)
          .query(`SELECT name, admissionFee FROM dbo.Courses WHERE id=@cid ${s.clause}`);
        const course = cr.recordset[0];
        if (course && course.admissionFee > 0) {
          await createVoucher(pool, {
            entityId: batch.entityId, branchId: batch.branchId,
            studentId, amount: course.admissionFee, description: `Admission Fee — ${course.name}`,
            items: [{ batchId: null, label: `${course.name} — Admission Fee`, amount: course.admissionFee }],
          });
        }
      } catch (e) {
        console.error("enroll: admission-fee voucher failed", e);
        warning = "Enrolled, but the admission-fee voucher could not be created — add it manually.";
      }
    }
    res.status(201).json({ ...r.recordset[0], warning });
  } catch (e) { next(e); }
});

// DELETE /api/enrollments/:id
router.delete("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.Enrollments WHERE id = @id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Enrollment not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

// GET /api/enrollments/transfers/list?studentId=
router.get("/transfers/list", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "t.entityId", branchCol: "t.branchId" });
    const request = s.apply(pool.request());
    let where = "";
    if (req.query.studentId) {
      request.input("sid", sql.Int, Number(req.query.studentId));
      where = "AND t.studentId = @sid";
    }
    const r = await request.query(`
      SELECT t.*, s.fullName AS studentName,
             bf.name AS fromBatchName, bt.name AS toBatchName
      FROM dbo.Transfers t
      JOIN dbo.Students s ON s.id = t.studentId
      LEFT JOIN dbo.Batches bf ON bf.id = t.fromBatchId
      LEFT JOIN dbo.Batches bt ON bt.id = t.toBatchId
      WHERE 1=1 ${s.clause} ${where}
      ORDER BY t.createdAt DESC
    `);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/enrollments/transfer — schedule a batch transfer (effective next month)
router.post("/transfer", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const s = scope(ctx);
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const enrollmentId = b.enrollmentId ? Number(b.enrollmentId) : null;
    const toBatchId = Number(b.toBatchId);
    if (!studentId || !toBatchId) return res.status(400).json({ error: "studentId and toBatchId are required" });

    const stu = await s.apply(pool.request()).input("sid", sql.Int, studentId)
      .query(`SELECT id, branchId FROM dbo.Students WHERE id=@sid ${s.clause}`);
    const student = stu.recordset[0];
    if (!student) return res.status(400).json({ error: "Student does not exist" });

    // The destination batch must belong to the caller's tenant (never trust the client id).
    const tb = await s.apply(pool.request()).input("bid", sql.Int, toBatchId)
      .query(`SELECT id FROM dbo.Batches WHERE id=@bid ${s.clause}`);
    if (!tb.recordset[0]) return res.status(400).json({ error: "Destination batch does not exist" });

    let fromBatchId: number | null = b.fromBatchId ? Number(b.fromBatchId) : null;
    if (enrollmentId && !fromBatchId) {
      const en = await s.apply(pool.request()).input("eid", sql.Int, enrollmentId)
        .query(`SELECT batchId FROM dbo.Enrollments WHERE id = @eid ${s.clause}`);
      fromBatchId = en.recordset[0]?.batchId ?? null;
    }

    const effectiveMonth = nextMonth();
    const r = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("branch", sql.Int, student.branchId)
      .input("sid", sql.Int, studentId)
      .input("eid", sql.Int, enrollmentId)
      .input("from", sql.Int, fromBatchId)
      .input("to", sql.Int, toBatchId)
      .input("reason", sql.NVarChar, str(b.reason))
      .input("month", sql.Char, effectiveMonth)
      .query(`INSERT INTO dbo.Transfers (entityId, branchId, studentId, enrollmentId, fromBatchId, toBatchId, reason, effectiveMonth)
              OUTPUT INSERTED.* VALUES (@ent, @branch, @sid, @eid, @from, @to, @reason, @month)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

export default router;
