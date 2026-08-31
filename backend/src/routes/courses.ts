import { Router } from "express";
import { getPool, sql } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";
import { MAX_IMPORT_ROWS, rowGetter, lc, trimStr, toNum, type ImportResult } from "../importUtils";

const router = Router();

// entity_admin + branch_manager may create/edit courses & batches; others view.
const canWrite = requireRole("entity_admin", "branch_manager");

// POST /api/courses/import — bulk create courses from parsed CSV/XLSX rows.
// Case-insensitive dedupe (vs existing courses and within the file). Pass
// validateOnly:true for a dry-run preview.
router.post("/import", canWrite, async (req, res, next) => {
  try {
    const ctx = (req as AuthedRequest).ctx!;
    const rows: Record<string, unknown>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const validateOnly = !!req.body?.validateOnly;
    if (!rows.length) return res.status(400).json({ error: "No rows to import" });
    if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `Max ${MAX_IMPORT_ROWS} rows per import; split the file.` });

    const pool = await getPool();
    const defaultBranch = resolveWriteBranch(ctx, req.body?.branchId != null ? Number(req.body.branchId) : null);
    if (defaultBranch == null) return res.status(400).json({ error: "Select a target branch for the import" });

    // Existing course names (this entity) for case-insensitive dedupe.
    const ex = await pool.request().input("ent", sql.Int, ctx.entityId).query("SELECT name FROM dbo.Courses WHERE entityId=@ent");
    const existing = new Set<string>(ex.recordset.map((r: { name: string }) => lc(r.name)));

    // Branches in scope, for optional per-row `branch` override (by name).
    const bs = scope(ctx, { branchCol: "id" });
    const brRes = await bs.apply(pool.request()).query(`SELECT id, name FROM dbo.Branches WHERE 1=1 ${bs.clause}`);
    const branchMap = new Map<string, number>(brRes.recordset.map((b: { id: number; name: string }) => [lc(b.name), b.id]));

    const result: ImportResult = { validateOnly, total: rows.length, created: 0, skipped: [], errors: [] };
    const seen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const g = rowGetter(rows[i]);
      const rn = i + 2; // header is row 1
      const name = trimStr(g("name", "course", "coursename", "coursetitle"));
      if (!name) { result.errors.push({ row: rn, reason: "Missing course name" }); continue; }
      const key = lc(name);
      if (existing.has(key) || seen.has(key)) { result.skipped.push({ row: rn, reason: `Course "${name}" already exists` }); continue; }

      let branchId = defaultBranch;
      const brName = trimStr(g("branch", "branchname", "campus"));
      if (brName) {
        const bid = branchMap.get(lc(brName));
        if (!bid) { result.errors.push({ row: rn, reason: `Branch "${brName}" not found` }); continue; }
        branchId = bid;
      }

      seen.add(key);
      if (!validateOnly) {
        const durRaw = g("durationmonths", "duration", "months");
        await pool.request()
          .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, branchId)
          .input("name", sql.NVarChar, name)
          .input("code", sql.NVarChar, trimStr(g("code")))
          .input("level", sql.NVarChar, trimStr(g("level")))
          .input("dur", sql.Int, durRaw != null ? Math.round(toNum(durRaw)) : null)
          .input("desc", sql.NVarChar, trimStr(g("description", "desc")))
          .input("adm", sql.Float, toNum(g("admissionfee", "admission")))
          .input("mon", sql.Float, toNum(g("monthlyfee", "monthly")))
          .input("exam", sql.Float, toNum(g("examfee", "exam")))
          .query(`INSERT INTO dbo.Courses (entityId, branchId, name, code, level, durationMonths, description, admissionFee, monthlyFee, examFee, status)
                  VALUES (@ent,@branch,@name,@code,@level,@dur,@desc,@adm,@mon,@exam,'active')`);
      }
      result.created += 1;
    }
    res.json(result);
  } catch (e) { next(e); }
});

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
    const s = scope((req as AuthedRequest).ctx, { entityCol: "c.entityId", branchCol: "c.branchId" });
    const request = s.apply(pool.request());
    const search = String(req.query.search || "").trim();
    let searchClause = "";
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      searchClause = "AND (c.name LIKE @search OR c.code LIKE @search)";
    }
    const result = await request.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM dbo.Batches b WHERE b.courseId = c.id) AS batchCount
      FROM dbo.Courses c
      WHERE 1=1 ${s.clause} ${searchClause}
      ORDER BY c.createdAt DESC
    `);
    res.json(result.recordset);
  } catch (e) { next(e); }
});

// GET /api/courses/:id — course + its batches
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const c = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Courses WHERE id = @id ${s.clause}`);
    if (!c.recordset[0]) return res.status(404).json({ error: "Course not found" });
    const b = await s.apply(pool.request()).input("cid", sql.Int, id)
      .query(`SELECT * FROM dbo.Batches WHERE courseId = @cid ${s.clause} ORDER BY name`);
    res.json({ ...c.recordset[0], batches: b.recordset });
  } catch (e) { next(e); }
});

// POST /api/courses
router.post("/", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    if (!b.name || !String(b.name).trim())
      return res.status(400).json({ error: "Course name is required" });
    // A course belongs to a branch, validated against the caller's entity scope.
    const branchId = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
    if (branchId == null) return res.status(400).json({ error: "A valid branch is required" });
    const result = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("branch", sql.Int, branchId)
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("code", sql.NVarChar, str(b.code))
      .input("level", sql.NVarChar, str(b.level))
      .input("durationMonths", sql.Int, intOrNull(b.durationMonths))
      .input("description", sql.NVarChar, str(b.description))
      .input("admissionFee", sql.Float, num(b.admissionFee))
      .input("monthlyFee", sql.Float, num(b.monthlyFee))
      .input("examFee", sql.Float, num(b.examFee))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .query(`
        INSERT INTO dbo.Courses (entityId, branchId, name, code, level, durationMonths, description, admissionFee, monthlyFee, examFee, status)
        OUTPUT INSERTED.*
        VALUES (@ent, @branch, @name, @code, @level, @durationMonths, @description, @admissionFee, @monthlyFee, @examFee, @status)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (e) { next(e); }
});

// PUT /api/courses/:id
router.put("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Courses WHERE id = @id ${s.clause}`);
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Course not found" });
    const b = req.body || {};
    const result = await s.apply(pool.request())
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
      .query(`
        UPDATE dbo.Courses SET
          name=@name, code=@code, level=@level, durationMonths=@durationMonths,
          description=@description, admissionFee=@admissionFee, monthlyFee=@monthlyFee,
          examFee=@examFee, status=@status, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id ${s.clause}
      `);
    res.json(result.recordset[0]);
  } catch (e) { next(e); }
});

// DELETE /api/courses/:id (cascades batches)
router.delete("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.Courses WHERE id = @id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Course not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- Batches (nested) — inherit their parent course's entity + branch ----

// GET /api/courses/:id/batches
router.get("/:id/batches", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    const r = await s.apply(pool.request()).input("cid", sql.Int, id)
      .query(`SELECT * FROM dbo.Batches WHERE courseId = @cid ${s.clause} ORDER BY name`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/courses/:id/batches
router.post("/:id/batches", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const courseId = Number(req.params.id);
    const b = req.body || {};
    if (isNaN(courseId)) return res.status(400).json({ error: "Invalid course id" });
    if (!b.name || !String(b.name).trim())
      return res.status(400).json({ error: "Batch name is required" });
    // Load the parent course within scope; the batch inherits its branch.
    const c = await s.apply(pool.request()).input("cid", sql.Int, courseId)
      .query(`SELECT entityId, branchId FROM dbo.Courses WHERE id=@cid ${s.clause}`);
    const course = c.recordset[0];
    if (!course) return res.status(404).json({ error: "Course not found" });
    const result = await pool.request()
      .input("ent", sql.Int, course.entityId)
      .input("branch", sql.Int, course.branchId)
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
        INSERT INTO dbo.Batches (entityId, branchId, courseId, name, timeSlot, teacher, startDate, endDate, monthlyFee, capacity, status)
        OUTPUT INSERTED.*
        VALUES (@ent, @branch, @courseId, @name, @timeSlot, @teacher, @startDate, @endDate, @monthlyFee, @capacity, @status)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 547)
      return res.status(400).json({ error: "Course does not exist" });
    next(e);
  }
});

// PUT /api/courses/:id/batches/:batchId
router.put("/:id/batches/:batchId", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const batchId = Number(req.params.batchId);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch id" });
    const existing = await s.apply(pool.request()).input("id", sql.Int, batchId)
      .query(`SELECT * FROM dbo.Batches WHERE id = @id ${s.clause}`);
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Batch not found" });
    const b = req.body || {};
    const result = await s.apply(pool.request())
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
        WHERE id=@id ${s.clause}
      `);
    res.json(result.recordset[0]);
  } catch (e) { next(e); }
});

// DELETE /api/courses/:id/batches/:batchId
router.delete("/:id/batches/:batchId", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const batchId = Number(req.params.batchId);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, batchId)
      .query(`DELETE FROM dbo.Batches WHERE id = @id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Batch not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
