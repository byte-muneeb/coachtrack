import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
function intOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
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

// GET /api/courses — list with batch counts
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const search = String(req.query.search || "").trim();
    const request = pool.request();
    let where = "";
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      where = "WHERE c.name LIKE @search OR c.code LIKE @search";
    }
    const result = await request.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM dbo.Batches b WHERE b.courseId = c.id) AS batchCount
      FROM dbo.Courses c
      ${where}
      ORDER BY c.createdAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    next(e);
  }
});

// GET /api/courses/:id — course + its batches
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const c = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Courses WHERE id = @id");
    if (!c.recordset[0]) return res.status(404).json({ error: "Course not found" });
    const b = await pool.request().input("cid", sql.Int, id)
      .query("SELECT * FROM dbo.Batches WHERE courseId = @cid ORDER BY name");
    res.json({ ...c.recordset[0], batches: b.recordset });
  } catch (e) {
    next(e);
  }
});

// POST /api/courses
router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (!b.name || !String(b.name).trim())
      return res.status(400).json({ error: "Course name is required" });
    const result = await pool.request()
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("code", sql.NVarChar, str(b.code))
      .input("level", sql.NVarChar, str(b.level))
      .input("durationMonths", sql.Int, intOrNull(b.durationMonths))
      .input("description", sql.NVarChar, str(b.description))
      .input("admissionFee", sql.Float, num(b.admissionFee))
      .input("monthlyFee", sql.Float, num(b.monthlyFee))
      .input("examFee", sql.Float, num(b.examFee))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .input("branchId", sql.Int, b.branchId ? Number(b.branchId) : null)
      .query(`
        INSERT INTO dbo.Courses (name, code, level, durationMonths, description, admissionFee, monthlyFee, examFee, status, branchId)
        OUTPUT INSERTED.*
        VALUES (@name, @code, @level, @durationMonths, @description, @admissionFee, @monthlyFee, @examFee, @status, @branchId)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// PUT /api/courses/:id
router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Courses WHERE id = @id");
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Course not found" });
    const b = req.body || {};
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("code", sql.NVarChar, b.code !== undefined ? str(b.code) : cur.code)
      .input("level", sql.NVarChar, b.level !== undefined ? str(b.level) : cur.level)
      .input("durationMonths", sql.Int, b.durationMonths !== undefined ? intOrNull(b.durationMonths) : cur.durationMonths)
      .input("description", sql.NVarChar, b.description !== undefined ? str(b.description) : cur.description)
      .input("admissionFee", sql.Float, b.admissionFee !== undefined ? num(b.admissionFee) : cur.admissionFee)
      .input("monthlyFee", sql.Float, b.monthlyFee !== undefined ? num(b.monthlyFee) : cur.monthlyFee)
      .input("examFee", sql.Float, b.examFee !== undefined ? num(b.examFee) : cur.examFee)
      .input("status", sql.NVarChar, b.status !== undefined ? (str(b.status) || "active") : cur.status)
      .input("branchId", sql.Int, b.branchId !== undefined ? (b.branchId ? Number(b.branchId) : null) : cur.branchId)
      .query(`
        UPDATE dbo.Courses SET
          name=@name, code=@code, level=@level, durationMonths=@durationMonths,
          description=@description, admissionFee=@admissionFee, monthlyFee=@monthlyFee,
          examFee=@examFee, status=@status, branchId=@branchId, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    res.json(result.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/courses/:id (cascades batches)
router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.Courses WHERE id = @id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Course not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---- Batches (nested) ----

// GET /api/courses/:id/batches
router.get("/:id/batches", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    const r = await pool.request().input("cid", sql.Int, id)
      .query("SELECT * FROM dbo.Batches WHERE courseId = @cid ORDER BY name");
    res.json(r.recordset);
  } catch (e) {
    next(e);
  }
});

// POST /api/courses/:id/batches
router.post("/:id/batches", async (req, res, next) => {
  try {
    const pool = await getPool();
    const courseId = Number(req.params.id);
    const b = req.body || {};
    if (isNaN(courseId)) return res.status(400).json({ error: "Invalid course id" });
    if (!b.name || !String(b.name).trim())
      return res.status(400).json({ error: "Batch name is required" });
    const result = await pool.request()
      .input("courseId", sql.Int, courseId)
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("timeSlot", sql.NVarChar, str(b.timeSlot))
      .input("teacher", sql.NVarChar, str(b.teacher))
      .input("startDate", sql.Date, toDate(b.startDate))
      .input("endDate", sql.Date, toDate(b.endDate))
      .input("monthlyFee", sql.Float, num(b.monthlyFee))
      .input("capacity", sql.Int, intOrNull(b.capacity))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .query(`
        INSERT INTO dbo.Batches (courseId, name, timeSlot, teacher, startDate, endDate, monthlyFee, capacity, status)
        OUTPUT INSERTED.*
        VALUES (@courseId, @name, @timeSlot, @teacher, @startDate, @endDate, @monthlyFee, @capacity, @status)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 547)
      return res.status(400).json({ error: "Course does not exist" });
    next(e);
  }
});

// PUT /api/courses/:id/batches/:batchId
router.put("/:id/batches/:batchId", async (req, res, next) => {
  try {
    const pool = await getPool();
    const batchId = Number(req.params.batchId);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch id" });
    const existing = await pool.request().input("id", sql.Int, batchId)
      .query("SELECT * FROM dbo.Batches WHERE id = @id");
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Batch not found" });
    const b = req.body || {};
    const result = await pool.request()
      .input("id", sql.Int, batchId)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("timeSlot", sql.NVarChar, b.timeSlot !== undefined ? str(b.timeSlot) : cur.timeSlot)
      .input("teacher", sql.NVarChar, b.teacher !== undefined ? str(b.teacher) : cur.teacher)
      .input("startDate", sql.Date, b.startDate !== undefined ? toDate(b.startDate) : cur.startDate)
      .input("endDate", sql.Date, b.endDate !== undefined ? toDate(b.endDate) : cur.endDate)
      .input("monthlyFee", sql.Float, b.monthlyFee !== undefined ? num(b.monthlyFee) : cur.monthlyFee)
      .input("capacity", sql.Int, b.capacity !== undefined ? intOrNull(b.capacity) : cur.capacity)
      .input("status", sql.NVarChar, b.status !== undefined ? (str(b.status) || "active") : cur.status)
      .query(`
        UPDATE dbo.Batches SET
          name=@name, timeSlot=@timeSlot, teacher=@teacher, startDate=@startDate,
          endDate=@endDate, monthlyFee=@monthlyFee, capacity=@capacity, status=@status, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    res.json(result.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/courses/:id/batches/:batchId
router.delete("/:id/batches/:batchId", async (req, res, next) => {
  try {
    const pool = await getPool();
    const batchId = Number(req.params.batchId);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch id" });
    const r = await pool.request().input("id", sql.Int, batchId)
      .query("DELETE FROM dbo.Batches WHERE id = @id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Batch not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
