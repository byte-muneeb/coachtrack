import { Router } from "express";
import { getPool, sql } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope } from "../tenant";
import { MAX_IMPORT_ROWS, rowGetter, lc, trimStr, toDateStr, type ImportResult } from "../importUtils";

const router = Router();

// Who can mark attendance (reads are open to any scoped user).
const canMark = requireRole("entity_admin", "branch_manager", "front_desk", "teacher");

const STATUSES = new Set(["present", "absent", "late", "leave"]);
function ymd(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// GET /api/attendance/roster?date=YYYY-MM-DD&branch=&search=
// Active students in scope + their status for that date (null = unmarked).
router.get("/roster", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "s.entityId", branchCol: "s.branchId" });
    const date = ymd(req.query.date) ?? new Date().toISOString().slice(0, 10);
    const request = s.apply(pool.request()).input("date", sql.Date, date);
    const extra: string[] = [];
    if (req.query.branch && String(req.query.branch) !== "all") {
      request.input("branch", sql.Int, Number(req.query.branch));
      extra.push("s.branchId = @branch");
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      extra.push("(s.fullName LIKE @search OR s.registryId LIKE @search)");
    }
    // Course / batch filters (case-insensitive; batch carries the time slot).
    const course = String(req.query.course || "").trim();
    if (course && course !== "all") {
      request.input("course", sql.NVarChar, course);
      extra.push("LOWER(s.course) = LOWER(@course)");
    }
    const batch = String(req.query.batch || "").trim();
    if (batch && batch !== "all") {
      request.input("batch", sql.NVarChar, batch);
      extra.push("LOWER(s.batch) = LOWER(@batch)");
    }
    const extraClause = extra.length ? "AND " + extra.join(" AND ") : "";
    const r = await request.query(`
      SELECT s.id AS studentId, s.fullName AS studentName, s.registryId, s.course, s.batch, s.branchId,
             a.status, a.note
      FROM dbo.Students s
      LEFT JOIN dbo.Attendance a ON a.studentId = s.id AND a.date = @date
      WHERE s.status = 'active' ${s.clause} ${extraClause}
      ORDER BY s.fullName
    `);
    res.json({ date, roster: r.recordset });
  } catch (e) { next(e); }
});

// POST /api/attendance/mark  { date, marks: [{ studentId, status, note? }] }
router.post("/mark", canMark, async (req, res, next) => {
  try {
    const pool = await getPool();
    const areq = req as AuthedRequest;
    const ctx = areq.ctx!;
    const userId = areq.user?.userId ?? null;
    const b = req.body || {};
    const date = ymd(b.date);
    if (!date) return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required" });
    const marks: Array<{ studentId: number; status: string; note?: string }> = Array.isArray(b.marks) ? b.marks : [];
    if (!marks.length) return res.status(400).json({ error: "No marks to save" });

    // Validate the referenced students are in the caller's scope; map id -> branchId.
    const ids = [...new Set(marks.map((m) => Number(m.studentId)).filter((n) => !isNaN(n)))];
    if (!ids.length) return res.status(400).json({ error: "No valid students" });
    const s = scope(ctx);
    const stu = await s.apply(pool.request()).input("ids", sql.Int, ids)
      .query(`SELECT id, branchId FROM dbo.Students WHERE id = ANY(@ids) ${s.clause}`);
    const branchOf = new Map<number, number>(stu.recordset.map((x: { id: number; branchId: number }) => [x.id, x.branchId]));

    let saved = 0;
    for (const m of marks) {
      const sid = Number(m.studentId);
      const branchId = branchOf.get(sid);
      if (branchId == null) continue; // out of scope — skip
      const status = STATUSES.has(m.status) ? m.status : "present";
      await pool.request()
        .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, branchId)
        .input("sid", sql.Int, sid).input("date", sql.Date, date)
        .input("status", sql.NVarChar, status)
        .input("note", sql.NVarChar, m.note ? String(m.note).trim() : null)
        .input("by", sql.Int, userId)
        .query(`INSERT INTO dbo.Attendance (entityId, branchId, studentId, date, status, note, markedBy)
                VALUES (@ent,@branch,@sid,@date,@status,@note,@by)
                ON CONFLICT (studentId, date) DO UPDATE
                  SET status=EXCLUDED.status, note=EXCLUDED.note, markedBy=EXCLUDED.markedBy, updatedAt=now()`);
      saved += 1;
    }
    res.json({ saved, date });
  } catch (e) { next(e); }
});

// GET /api/attendance/summary/:studentId?from=&to=
router.get("/summary/:studentId", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.studentId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const request = s.apply(pool.request()).input("id", sql.Int, id);
    const range: string[] = [];
    const from = ymd(req.query.from); const to = ymd(req.query.to);
    if (from) { request.input("from", sql.Date, from); range.push("date >= @from"); }
    if (to) { request.input("to", sql.Date, to); range.push("date <= @to"); }
    const rangeClause = range.length ? "AND " + range.join(" AND ") : "";
    const r = await request.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='present') AS presentCount,
        COUNT(*) FILTER (WHERE status='absent')  AS absentCount,
        COUNT(*) FILTER (WHERE status='late')    AS lateCount,
        COUNT(*) FILTER (WHERE status='leave')   AS leaveCount,
        COUNT(*) AS totalMarked
      FROM dbo.Attendance WHERE studentId = @id ${s.clause} ${rangeClause}
    `);
    const row = r.recordset[0] || {};
    const present = Number(row.presentCount || 0) + Number(row.lateCount || 0); // late still counts as attended
    const total = Number(row.totalMarked || 0);
    const attendancePct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
    res.json({ ...row, attendancePct });
  } catch (e) { next(e); }
});

// POST /api/attendance/import — bulk attendance from parsed CSV/XLSX rows.
// Each row: registryId (identifies the student), date, status, note?. The student
// is matched by registry ID within the entity; records upsert by (student, date).
router.post("/import", canMark, async (req, res, next) => {
  try {
    const ctx = (req as AuthedRequest).ctx!;
    const userId = (req as AuthedRequest).user?.userId ?? null;
    const rows: Record<string, unknown>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const validateOnly = !!req.body?.validateOnly;
    if (!rows.length) return res.status(400).json({ error: "No rows to import" });
    if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `Max ${MAX_IMPORT_ROWS} rows per import; split the file.` });

    const pool = await getPool();
    const s = scope(ctx);
    const sRes = await s.apply(pool.request()).query(`SELECT id, registryId, branchId FROM dbo.Students WHERE 1=1 ${s.clause}`);
    const byReg = new Map<string, { id: number; branchId: number }>(
      sRes.recordset.map((x: { id: number; registryId: string; branchId: number }) => [lc(x.registryId), { id: x.id, branchId: x.branchId }])
    );

    const result: ImportResult = { validateOnly, total: rows.length, created: 0, skipped: [], errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const g = rowGetter(rows[i]);
      const rn = i + 2;
      const reg = trimStr(g("registryid", "rollno", "roll", "regno", "registrationno"));
      if (!reg) { result.errors.push({ row: rn, reason: "Missing registry ID" }); continue; }
      const stu = byReg.get(lc(reg));
      if (!stu) { result.errors.push({ row: rn, reason: `Student "${reg}" not found` }); continue; }
      const date = toDateStr(g("date", "attendancedate"));
      if (!date) { result.errors.push({ row: rn, reason: "Missing or invalid date" }); continue; }
      const rawStatus = lc(g("status"));
      let status = "present";
      if (rawStatus) {
        if (!STATUSES.has(rawStatus)) { result.errors.push({ row: rn, reason: `Invalid status "${rawStatus}"` }); continue; }
        status = rawStatus;
      }
      const note = trimStr(g("note", "remarks"));
      if (!validateOnly) {
        await pool.request()
          .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, stu.branchId)
          .input("sid", sql.Int, stu.id).input("date", sql.Date, date)
          .input("status", sql.NVarChar, status).input("note", sql.NVarChar, note).input("by", sql.Int, userId)
          .query(`INSERT INTO dbo.Attendance (entityId, branchId, studentId, date, status, note, markedBy)
                  VALUES (@ent,@branch,@sid,@date,@status,@note,@by)
                  ON CONFLICT (studentId, date) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, markedBy=EXCLUDED.markedBy, updatedAt=now()`);
      }
      result.created += 1;
    }
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
