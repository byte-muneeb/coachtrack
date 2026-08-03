import { Router } from "express";
import { getPool, sql } from "../db";
import { createVoucher } from "./vouchers";

const router = Router();

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
    const studentId = Number(req.query.studentId);
    if (!studentId) return res.status(400).json({ error: "studentId is required" });
    const r = await pool.request().input("sid", sql.Int, studentId)
      .query(`${ENROLLMENT_SELECT} WHERE e.studentId = @sid ORDER BY e.createdAt DESC`);
    res.json(r.recordset);
  } catch (e) {
    next(e);
  }
});

// POST /api/enrollments — enroll a student in a batch (fee snapshotted from batch)
router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const batchId = Number(b.batchId);
    if (!studentId || !batchId) return res.status(400).json({ error: "studentId and batchId are required" });

    const bat = await pool.request().input("bid", sql.Int, batchId)
      .query("SELECT id, courseId, monthlyFee FROM dbo.Batches WHERE id = @bid");
    const batch = bat.recordset[0];
    if (!batch) return res.status(400).json({ error: "Batch does not exist" });

    // Avoid duplicate active enrollment in the same batch.
    const dup = await pool.request().input("sid", sql.Int, studentId).input("bid", sql.Int, batchId)
      .query("SELECT id FROM dbo.Enrollments WHERE studentId=@sid AND batchId=@bid AND status='active'");
    if (dup.recordset[0]) return res.status(400).json({ error: "Student already enrolled in this batch" });

    // Is this the student's FIRST active enrollment in this course? (admission is once per course)
    const prior = await pool.request().input("sid", sql.Int, studentId).input("cid", sql.Int, batch.courseId)
      .query("SELECT COUNT(*) AS c FROM dbo.Enrollments WHERE studentId=@sid AND courseId=@cid AND status='active'");
    const firstInCourse = (prior.recordset[0].c as number) === 0;

    const monthlyFee = b.monthlyFee !== undefined ? Number(b.monthlyFee) : batch.monthlyFee;
    const discount = Math.max(0, Number(b.discount) || 0);
    const r = await pool.request()
      .input("sid", sql.Int, studentId)
      .input("bid", sql.Int, batchId)
      .input("cid", sql.Int, batch.courseId)
      .input("fee", sql.Float, isNaN(monthlyFee) ? batch.monthlyFee : monthlyFee)
      .input("disc", sql.Float, discount)
      .input("start", sql.Date, b.startDate ? new Date(String(b.startDate)) : null)
      .query(`INSERT INTO dbo.Enrollments (studentId, batchId, courseId, monthlyFee, discount, startDate)
              OUTPUT INSERTED.* VALUES (@sid, @bid, @cid, @fee, @disc, @start)`);

    // Charge the course admission fee once (on the first enrollment in that course).
    if (firstInCourse) {
      const cr = await pool.request().input("cid", sql.Int, batch.courseId)
        .query("SELECT name, admissionFee FROM dbo.Courses WHERE id=@cid");
      const course = cr.recordset[0];
      if (course && course.admissionFee > 0) {
        await createVoucher(pool, {
          studentId, amount: course.admissionFee, description: `Admission Fee — ${course.name}`,
          items: [{ batchId: null, label: `${course.name} — Admission Fee`, amount: course.admissionFee }],
        });
      }
    }
    res.status(201).json(r.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/enrollments/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.Enrollments WHERE id = @id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Enrollment not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/enrollments/transfers/list?studentId=
router.get("/transfers/list", async (req, res, next) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    let where = "";
    if (req.query.studentId) {
      request.input("sid", sql.Int, Number(req.query.studentId));
      where = "WHERE t.studentId = @sid";
    }
    const r = await request.query(`
      SELECT t.*, s.fullName AS studentName,
             bf.name AS fromBatchName, bt.name AS toBatchName
      FROM dbo.Transfers t
      JOIN dbo.Students s ON s.id = t.studentId
      LEFT JOIN dbo.Batches bf ON bf.id = t.fromBatchId
      LEFT JOIN dbo.Batches bt ON bt.id = t.toBatchId
      ${where}
      ORDER BY t.createdAt DESC
    `);
    res.json(r.recordset);
  } catch (e) {
    next(e);
  }
});

// POST /api/enrollments/transfer — schedule a batch transfer (effective next month)
router.post("/transfer", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const studentId = Number(b.studentId);
    const enrollmentId = b.enrollmentId ? Number(b.enrollmentId) : null;
    const toBatchId = Number(b.toBatchId);
    if (!studentId || !toBatchId) return res.status(400).json({ error: "studentId and toBatchId are required" });

    // Resolve the source batch from the enrollment if given.
    let fromBatchId: number | null = b.fromBatchId ? Number(b.fromBatchId) : null;
    if (enrollmentId && !fromBatchId) {
      const en = await pool.request().input("eid", sql.Int, enrollmentId)
        .query("SELECT batchId FROM dbo.Enrollments WHERE id = @eid");
      fromBatchId = en.recordset[0]?.batchId ?? null;
    }

    const effectiveMonth = nextMonth();
    const r = await pool.request()
      .input("sid", sql.Int, studentId)
      .input("eid", sql.Int, enrollmentId)
      .input("from", sql.Int, fromBatchId)
      .input("to", sql.Int, toBatchId)
      .input("reason", sql.NVarChar, str(b.reason))
      .input("month", sql.Char, effectiveMonth)
      .query(`INSERT INTO dbo.Transfers (studentId, enrollmentId, fromBatchId, toBatchId, reason, effectiveMonth)
              OUTPUT INSERTED.* VALUES (@sid, @eid, @from, @to, @reason, @month)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
