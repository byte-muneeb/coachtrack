import { Router } from "express";
import { getPool, sql } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";
import { MAX_IMPORT_ROWS, rowGetter, lc, trimStr, toNum, type ImportResult } from "../importUtils";

const router = Router();
// Who can create tests / enter marks (reads are open to any scoped user).
const canWrite = requireRole("entity_admin", "branch_manager", "teacher");

function num(v: unknown, def = 0): number { const n = Number(v); return isNaN(n) ? def : n; }

// Standard competition ranking (1224) over obtained marks, absentees excluded.
function assignRanks<T extends { obtainedMarks: number | null; absent: boolean }>(rows: T[]): (T & { rank: number | null })[] {
  const ranked = rows.map((r) => ({ ...r, rank: null as number | null }));
  const scored = ranked.filter((r) => !r.absent && r.obtainedMarks != null)
    .sort((a, b) => (b.obtainedMarks as number) - (a.obtainedMarks as number));
  let lastMark: number | null = null, lastRank = 0;
  scored.forEach((r, i) => {
    if (lastMark === null || r.obtainedMarks !== lastMark) { lastRank = i + 1; lastMark = r.obtainedMarks; }
    r.rank = lastRank;
  });
  return ranked;
}

// Fetch a test (in scope) plus its ordered subjects, or null.
async function loadTest(req: AuthedRequest, id: number) {
  const pool = await getPool();
  const s = scope(req.ctx);
  const t = await s.apply(pool.request()).input("id", sql.Int, id)
    .query(`SELECT * FROM dbo.Tests WHERE id=@id ${s.clause}`);
  const test = t.recordset[0];
  if (!test) return null;
  const subs = await pool.request().input("tid", sql.Int, id)
    .query("SELECT id, name, maxMarks, position FROM dbo.TestSubjects WHERE testId=@tid ORDER BY position, id");
  return { ...test, subjects: subs.recordset };
}

// GET /api/tests?courseId=&batchId=&search= — tests in scope with quick stats.
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "t.entityId", branchCol: "t.branchId" });
    const request = s.apply(pool.request());
    const extra: string[] = [];
    if (req.query.courseId) { request.input("cid", sql.Int, Number(req.query.courseId)); extra.push("t.courseId = @cid"); }
    if (req.query.batchId) { request.input("bid", sql.Int, Number(req.query.batchId)); extra.push("t.batchId = @bid"); }
    const search = String(req.query.search || "").trim();
    if (search) { request.input("q", sql.NVarChar, `%${search}%`); extra.push("t.name LIKE @q"); }
    const where = extra.length ? "AND " + extra.join(" AND ") : "";
    const r = await request.query(`
      SELECT t.*, c.name AS courseName, b.name AS batchName, b.timeSlot AS batchTimeSlot,
        (SELECT COUNT(*) FROM dbo.TestSubjects ts WHERE ts.testId = t.id) AS subjectCount,
        (SELECT COUNT(*) FROM dbo.TestResults r WHERE r.testId = t.id) AS resultCount
      FROM dbo.Tests t
      LEFT JOIN dbo.Courses c ON c.id = t.courseId
      LEFT JOIN dbo.Batches b ON b.id = t.batchId
      WHERE 1=1 ${s.clause} ${where}
      ORDER BY t.testDate DESC NULLS LAST, t.id DESC
    `);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// GET /api/tests/:id — a test with its subjects.
router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const test = await loadTest(req as AuthedRequest, id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    res.json(test);
  } catch (e) { next(e); }
});

// POST /api/tests — create a test, optionally with subjects (total = sum of maxes).
router.post("/", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const courseId = Number(b.courseId);
    if (!courseId) return res.status(400).json({ error: "A course is required" });
    if (!trimStr(b.name)) return res.status(400).json({ error: "Test name is required" });
    const branchId = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
    if (branchId == null) return res.status(400).json({ error: "A valid branch is required" });

    // Course must be in scope; batch (optional) must belong to that course + branch.
    const s = scope(ctx);
    const cr = await s.apply(pool.request()).input("cid", sql.Int, courseId)
      .query(`SELECT id FROM dbo.Courses WHERE id=@cid ${s.clause}`);
    if (!cr.recordset[0]) return res.status(400).json({ error: "Course does not exist" });
    let batchId: number | null = b.batchId != null && String(b.batchId) !== "" ? Number(b.batchId) : null;
    if (batchId != null) {
      const br = await s.apply(pool.request()).input("bid", sql.Int, batchId).input("cid", sql.Int, courseId)
        .query(`SELECT id FROM dbo.Batches WHERE id=@bid AND courseId=@cid ${s.clause}`);
      if (!br.recordset[0]) return res.status(400).json({ error: "Batch does not belong to that course" });
    }

    const subjects: { name: string; maxMarks: number }[] = Array.isArray(b.subjects)
      ? b.subjects.map((x: { name?: unknown; maxMarks?: unknown }) => ({ name: trimStr(x.name) || "", maxMarks: num(x.maxMarks) }))
        .filter((x: { name: string }) => x.name)
      : [];
    const totalMarks = subjects.length ? subjects.reduce((a, x) => a + x.maxMarks, 0) : num(b.totalMarks);
    if (totalMarks <= 0) return res.status(400).json({ error: "Total marks must be greater than 0" });
    const passingMarks = num(b.passingMarks);

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const ins = await new sql.Request(tx)
        .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, branchId)
        .input("cid", sql.Int, courseId).input("bid", sql.Int, batchId)
        .input("name", sql.NVarChar, trimStr(b.name))
        .input("date", sql.Date, trimStr(b.testDate))
        .input("total", sql.Float, totalMarks).input("pass", sql.Float, passingMarks)
        .input("status", sql.NVarChar, trimStr(b.status) || "active")
        .query(`INSERT INTO dbo.Tests (entityId, branchId, courseId, batchId, name, testDate, totalMarks, passingMarks, status)
                OUTPUT INSERTED.id VALUES (@ent,@branch,@cid,@bid,@name,@date,@total,@pass,@status)`);
      const testId = ins.recordset[0].id as number;
      for (let i = 0; i < subjects.length; i++) {
        await new sql.Request(tx).input("ent", sql.Int, ctx.entityId).input("tid", sql.Int, testId)
          .input("name", sql.NVarChar, subjects[i].name).input("max", sql.Float, subjects[i].maxMarks).input("pos", sql.Int, i)
          .query("INSERT INTO dbo.TestSubjects (entityId, testId, name, maxMarks, position) VALUES (@ent,@tid,@name,@max,@pos)");
      }
      await tx.commit();
      const test = await loadTest(req as AuthedRequest, testId);
      res.status(201).json(test);
    } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
  } catch (e) { next(e); }
});

// PUT /api/tests/:id — edit header fields. Subjects can only be replaced while no
// results exist yet (to keep recorded marks consistent with the subject list).
router.put("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await loadTest(req as AuthedRequest, id);
    if (!existing) return res.status(404).json({ error: "Test not found" });
    const b = req.body || {};
    if (b.name !== undefined && !trimStr(b.name)) return res.status(400).json({ error: "Test name is required" });

    const hasResults = (await pool.request().input("tid", sql.Int, id)
      .query("SELECT COUNT(*) AS c FROM dbo.TestResults WHERE testId=@tid")).recordset[0].c;
    const wantsSubjectEdit = Array.isArray(b.subjects);
    if (wantsSubjectEdit && Number(hasResults) > 0)
      return res.status(409).json({ error: "Marks are already recorded — subjects can't be changed. Delete the results first." });

    let totalMarks = existing.totalMarks;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (wantsSubjectEdit) {
        await new sql.Request(tx).input("tid", sql.Int, id).query("DELETE FROM dbo.TestSubjects WHERE testId=@tid");
        const subjects = b.subjects.map((x: { name?: unknown; maxMarks?: unknown }) => ({ name: trimStr(x.name) || "", maxMarks: num(x.maxMarks) })).filter((x: { name: string }) => x.name);
        for (let i = 0; i < subjects.length; i++) {
          await new sql.Request(tx).input("ent", sql.Int, ctx.entityId).input("tid", sql.Int, id)
            .input("name", sql.NVarChar, subjects[i].name).input("max", sql.Float, subjects[i].maxMarks).input("pos", sql.Int, i)
            .query("INSERT INTO dbo.TestSubjects (entityId, testId, name, maxMarks, position) VALUES (@ent,@tid,@name,@max,@pos)");
        }
        if (subjects.length) totalMarks = subjects.reduce((a: number, x: { maxMarks: number }) => a + x.maxMarks, 0);
        else if (b.totalMarks !== undefined) totalMarks = num(b.totalMarks);
      } else if (b.totalMarks !== undefined && existing.subjects.length === 0) {
        totalMarks = num(b.totalMarks);
      }
      await new sql.Request(tx)
        .input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
        .input("name", sql.NVarChar, b.name !== undefined ? trimStr(b.name) : existing.name)
        .input("date", sql.Date, b.testDate !== undefined ? trimStr(b.testDate) : existing.testDate)
        .input("total", sql.Float, totalMarks)
        .input("pass", sql.Float, b.passingMarks !== undefined ? num(b.passingMarks) : existing.passingMarks)
        .input("status", sql.NVarChar, b.status !== undefined ? (trimStr(b.status) || "active") : existing.status)
        .query(`UPDATE dbo.Tests SET name=@name, testDate=@date, totalMarks=@total, passingMarks=@pass, status=@status, updatedAt=SYSUTCDATETIME()
                WHERE id=@id AND entityId=@ent`);
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
    res.json(await loadTest(req as AuthedRequest, id));
  } catch (e) { next(e); }
});

// DELETE /api/tests/:id
router.delete("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.Tests WHERE id=@id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Test not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

// GET /api/tests/:id/results — enrolled-student roster + marks + rank.
router.get("/:id/results", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const test = await loadTest(req as AuthedRequest, id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    // Roster = active students enrolled in the test's course (and batch if set).
    const s = scope((req as AuthedRequest).ctx, { entityCol: "s.entityId", branchCol: "s.branchId" });
    const request = s.apply(pool.request()).input("cid", sql.Int, test.courseId);
    let batchFilter = "";
    if (test.batchId != null) { request.input("bid", sql.Int, test.batchId); batchFilter = "AND e.batchId = @bid"; }
    const roster = await request.query(`
      SELECT DISTINCT s.id AS studentId, s.fullName AS studentName, s.registryId, s.branchId
      FROM dbo.Students s
      JOIN dbo.Enrollments e ON e.studentId = s.id AND e.status='active' AND e.courseId = @cid ${batchFilter}
      WHERE s.status='active' ${s.clause}
      ORDER BY s.fullName
    `);
    // Existing results + per-subject marks for this test.
    const rres = await pool.request().input("tid", sql.Int, id)
      .query("SELECT studentId, obtainedMarks, absent, remarks FROM dbo.TestResults WHERE testId=@tid");
    const resById = new Map<number, { obtainedMarks: number; absent: number; remarks: string | null }>(
      rres.recordset.map((r: { studentId: number; obtainedMarks: number; absent: number; remarks: string | null }) => [r.studentId, r]));
    const mres = await pool.request().input("tid", sql.Int, id)
      .query("SELECT studentId, subjectId, obtainedMarks FROM dbo.TestResultMarks WHERE testId=@tid");
    const marksByStudent = new Map<number, Map<number, number>>();
    for (const m of mres.recordset as { studentId: number; subjectId: number; obtainedMarks: number }[]) {
      if (!marksByStudent.has(m.studentId)) marksByStudent.set(m.studentId, new Map());
      marksByStudent.get(m.studentId)!.set(m.subjectId, m.obtainedMarks);
    }

    const base = roster.recordset.map((r: { studentId: number; studentName: string; registryId: string; branchId: number }) => {
      const res = resById.get(r.studentId);
      const has = res !== undefined;
      const absent = has && res!.absent === 1;
      const obtainedMarks = has && !absent ? Number(res!.obtainedMarks) : null;
      const subjMap = marksByStudent.get(r.studentId);
      const subjects = (test.subjects as { id: number; name: string; maxMarks: number }[]).map((su) => ({
        subjectId: su.id, name: su.name, maxMarks: su.maxMarks,
        obtainedMarks: subjMap && subjMap.has(su.id) ? Number(subjMap.get(su.id)) : null,
      }));
      return {
        studentId: r.studentId, studentName: r.studentName, registryId: r.registryId, branchId: r.branchId,
        recorded: has, absent, obtainedMarks,
        percentage: obtainedMarks != null && test.totalMarks > 0 ? Math.round((obtainedMarks / test.totalMarks) * 1000) / 10 : null,
        passed: obtainedMarks != null ? obtainedMarks >= test.passingMarks : null,
        remarks: has ? res!.remarks : null,
        subjects,
      };
    });
    res.json({ test, roster: assignRanks(base) });
  } catch (e) { next(e); }
});

// POST /api/tests/:id/results — bulk upsert marks.
// body.marks: [{ studentId, absent?, remarks?, total?, subjects?: [{subjectId, marks}] }]
router.post("/:id/results", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const userId = (req as AuthedRequest).user?.userId ?? null;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const test = await loadTest(req as AuthedRequest, id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const hasSubjects = (test.subjects as unknown[]).length > 0;
    const subjectIds = new Set((test.subjects as { id: number }[]).map((x) => x.id));
    const marks: { studentId: number; absent?: boolean; remarks?: string; total?: number; subjects?: { subjectId: number; marks: number }[] }[] =
      Array.isArray(req.body?.marks) ? req.body.marks : [];
    if (!marks.length) return res.status(400).json({ error: "No marks to save" });

    // Students in scope → their branch (also confirms tenant ownership).
    const s = scope(ctx);
    const ids = [...new Set(marks.map((m) => Number(m.studentId)).filter((n) => !isNaN(n)))];
    if (!ids.length) return res.status(400).json({ error: "No valid students" });
    const stu = await s.apply(pool.request()).input("ids", sql.Int, ids)
      .query(`SELECT id, branchId FROM dbo.Students WHERE id = ANY(@ids) ${s.clause}`);
    const branchOf = new Map<number, number>(stu.recordset.map((x: { id: number; branchId: number }) => [x.id, x.branchId]));

    let saved = 0;
    for (const m of marks) {
      const sid = Number(m.studentId);
      const branchId = branchOf.get(sid);
      if (branchId == null) continue; // out of scope — skip
      const absent = m.absent ? 1 : 0;
      // Total is summed from subjects when the test is subject-wise, else taken directly.
      let total = 0;
      const subjMarks: { subjectId: number; marks: number }[] = [];
      if (hasSubjects) {
        for (const sm of m.subjects || []) {
          if (!subjectIds.has(Number(sm.subjectId))) continue;
          const val = Math.max(0, num(sm.marks));
          subjMarks.push({ subjectId: Number(sm.subjectId), marks: val });
          total += val;
        }
      } else {
        total = Math.max(0, num(m.total));
      }
      if (absent) total = 0;

      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx)
          .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, branchId)
          .input("tid", sql.Int, id).input("sid", sql.Int, sid)
          .input("obt", sql.Float, total).input("abs", sql.Bit, absent)
          .input("rem", sql.NVarChar, m.remarks ? String(m.remarks).trim() : null).input("by", sql.Int, userId)
          .query(`INSERT INTO dbo.TestResults (entityId, branchId, testId, studentId, obtainedMarks, absent, remarks, markedBy)
                  VALUES (@ent,@branch,@tid,@sid,@obt,@abs,@rem,@by)
                  ON CONFLICT (testId, studentId) DO UPDATE
                    SET obtainedMarks=EXCLUDED.obtainedMarks, absent=EXCLUDED.absent, remarks=EXCLUDED.remarks, markedBy=EXCLUDED.markedBy, updatedAt=now()`);
        for (const sm of subjMarks) {
          await new sql.Request(tx).input("ent", sql.Int, ctx.entityId).input("tid", sql.Int, id)
            .input("sid", sql.Int, sid).input("subid", sql.Int, sm.subjectId).input("obt", sql.Float, sm.marks)
            .query(`INSERT INTO dbo.TestResultMarks (entityId, testId, studentId, subjectId, obtainedMarks)
                    VALUES (@ent,@tid,@sid,@subid,@obt)
                    ON CONFLICT (testId, studentId, subjectId) DO UPDATE SET obtainedMarks=EXCLUDED.obtainedMarks`);
        }
        await tx.commit();
        saved += 1;
      } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
    }
    res.json({ saved });
  } catch (e) { next(e); }
});

// GET /api/tests/student/:studentId — a student's test history (for the result card + trend).
router.get("/student/:studentId", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "t.entityId", branchCol: "t.branchId" });
    const id = Number(req.params.studentId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("sid", sql.Int, id).query(`
      SELECT t.id AS testId, t.name, t.testDate, t.totalMarks, t.passingMarks, c.name AS courseName,
             r.obtainedMarks, r.absent, r.remarks
      FROM dbo.TestResults r
      JOIN dbo.Tests t ON t.id = r.testId
      LEFT JOIN dbo.Courses c ON c.id = t.courseId
      WHERE r.studentId = @sid ${s.clause}
      ORDER BY t.testDate DESC NULLS LAST, t.id DESC
    `);
    const results = r.recordset.map((x: { obtainedMarks: number; absent: number; totalMarks: number; passingMarks: number }) => ({
      ...x,
      absent: x.absent === 1,
      percentage: !x.absent && x.totalMarks > 0 ? Math.round((Number(x.obtainedMarks) / x.totalMarks) * 1000) / 10 : null,
      passed: !x.absent ? Number(x.obtainedMarks) >= x.passingMarks : null,
    }));
    res.json(results);
  } catch (e) { next(e); }
});

// POST /api/tests/:id/import — bulk marks from parsed rows.
// Single-total test: columns registryId, marks (or "obtained"/"total"), absent?, remarks?.
// Subject-wise test: a column per subject NAME (case-insensitive), plus registryId.
router.post("/:id/import", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const userId = (req as AuthedRequest).user?.userId ?? null;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const test = await loadTest(req as AuthedRequest, id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const subjects = test.subjects as { id: number; name: string }[];
    const hasSubjects = subjects.length > 0;

    const rows: Record<string, unknown>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const validateOnly = !!req.body?.validateOnly;
    if (!rows.length) return res.status(400).json({ error: "No rows to import" });
    if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `Max ${MAX_IMPORT_ROWS} rows per import; split the file.` });

    const s = scope(ctx);
    const sRes = await s.apply(pool.request()).query(`SELECT id, registryId, branchId FROM dbo.Students WHERE 1=1 ${s.clause}`);
    const byReg = new Map<string, { id: number; branchId: number }>(
      sRes.recordset.map((x: { id: number; registryId: string; branchId: number }) => [lc(x.registryId), { id: x.id, branchId: x.branchId }]));

    const result: ImportResult = { validateOnly, total: rows.length, created: 0, skipped: [], errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const g = rowGetter(rows[i]);
      const rn = i + 2;
      const reg = trimStr(g("registryid", "rollno", "roll", "regno", "registrationno"));
      if (!reg) { result.errors.push({ row: rn, reason: "Missing registry ID" }); continue; }
      const stu = byReg.get(lc(reg));
      if (!stu) { result.errors.push({ row: rn, reason: `Student "${reg}" not found` }); continue; }
      const absent = ["1", "true", "yes", "y", "absent", "a"].includes(lc(g("absent")));
      let total = 0;
      const subjMarks: { subjectId: number; marks: number }[] = [];
      if (hasSubjects && !absent) {
        for (const su of subjects) {
          const val = Math.max(0, toNum(g(su.name)));
          subjMarks.push({ subjectId: su.id, marks: val });
          total += val;
        }
      } else if (!absent) {
        total = Math.max(0, toNum(g("marks", "obtained", "obtainedmarks", "total", "score")));
      }
      if (!validateOnly) {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          await new sql.Request(tx)
            .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, stu.branchId)
            .input("tid", sql.Int, id).input("sid", sql.Int, stu.id)
            .input("obt", sql.Float, total).input("abs", sql.Bit, absent ? 1 : 0)
            .input("rem", sql.NVarChar, trimStr(g("remarks", "note"))).input("by", sql.Int, userId)
            .query(`INSERT INTO dbo.TestResults (entityId, branchId, testId, studentId, obtainedMarks, absent, remarks, markedBy)
                    VALUES (@ent,@branch,@tid,@sid,@obt,@abs,@rem,@by)
                    ON CONFLICT (testId, studentId) DO UPDATE SET obtainedMarks=EXCLUDED.obtainedMarks, absent=EXCLUDED.absent, remarks=EXCLUDED.remarks, markedBy=EXCLUDED.markedBy, updatedAt=now()`);
          for (const sm of subjMarks) {
            await new sql.Request(tx).input("ent", sql.Int, ctx.entityId).input("tid", sql.Int, id)
              .input("sid", sql.Int, stu.id).input("subid", sql.Int, sm.subjectId).input("obt", sql.Float, sm.marks)
              .query(`INSERT INTO dbo.TestResultMarks (entityId, testId, studentId, subjectId, obtainedMarks)
                      VALUES (@ent,@tid,@sid,@subid,@obt)
                      ON CONFLICT (testId, studentId, subjectId) DO UPDATE SET obtainedMarks=EXCLUDED.obtainedMarks`);
          }
          await tx.commit();
        } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } result.errors.push({ row: rn, reason: e instanceof Error ? e.message : "Save failed" }); continue; }
      }
      result.created += 1;
    }
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
