import { Router } from "express";
import { getPool, sql } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";
import { MAX_IMPORT_ROWS, rowGetter, lc, trimStr, toNum, type ImportResult } from "../importUtils";

const router = Router();
// Who can create tests / enter marks (reads are open to any scoped user).
const canWrite = requireRole("entity_admin", "branch_manager", "teacher");

function num(v: unknown, def = 0): number { const n = Number(v); return isNaN(n) ? def : n; }

// Default grade bands by percentage. A failed result is always "F".
const GRADE_BANDS: [number, string][] = [[80, "A+"], [70, "A"], [60, "B"], [50, "C"], [40, "D"]];
function gradeFor(pct: number | null, passed: boolean | null): string | null {
  if (pct == null || passed == null) return null;
  if (!passed) return "F";
  for (const [min, g] of GRADE_BANDS) if (pct >= min) return g;
  return "F";
}

// Standard competition ranking (1224) over obtained marks, absentees excluded.
function competitionRank<T extends { obtainedMarks: number | null; absent: boolean }>(rows: T[], set: (r: T, rank: number) => void): void {
  const scored = rows.filter((r) => !r.absent && r.obtainedMarks != null)
    .sort((a, b) => (b.obtainedMarks as number) - (a.obtainedMarks as number));
  let lastMark: number | null = null, lastRank = 0;
  scored.forEach((r, i) => {
    if (lastMark === null || r.obtainedMarks !== lastMark) { lastRank = i + 1; lastMark = r.obtainedMarks; }
    set(r, lastRank);
  });
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
    .query("SELECT id, name, maxMarks, passingMarks, position FROM dbo.TestSubjects WHERE testId=@tid ORDER BY position, id");
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

    const subjects: { name: string; maxMarks: number; passingMarks: number }[] = Array.isArray(b.subjects)
      ? b.subjects.map((x: { name?: unknown; maxMarks?: unknown; passingMarks?: unknown }) => {
          const maxMarks = num(x.maxMarks);
          return { name: trimStr(x.name) || "", maxMarks, passingMarks: Math.min(num(x.passingMarks), maxMarks) };
        }).filter((x: { name: string }) => x.name)
      : [];
    const totalMarks = subjects.length ? subjects.reduce((a, x) => a + x.maxMarks, 0) : num(b.totalMarks);
    if (totalMarks <= 0) return res.status(400).json({ error: "Total marks must be greater than 0" });
    // For subject-wise tests, the overall pass mark defaults to the sum of subject pass marks.
    const passingMarks = b.passingMarks !== undefined ? num(b.passingMarks)
      : (subjects.length ? subjects.reduce((a, x) => a + x.passingMarks, 0) : 0);

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
          .input("name", sql.NVarChar, subjects[i].name).input("max", sql.Float, subjects[i].maxMarks)
          .input("pass", sql.Float, subjects[i].passingMarks).input("pos", sql.Int, i)
          .query("INSERT INTO dbo.TestSubjects (entityId, testId, name, maxMarks, passingMarks, position) VALUES (@ent,@tid,@name,@max,@pass,@pos)");
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
        const subjects = b.subjects.map((x: { name?: unknown; maxMarks?: unknown; passingMarks?: unknown }) => {
          const maxMarks = num(x.maxMarks);
          return { name: trimStr(x.name) || "", maxMarks, passingMarks: Math.min(num(x.passingMarks), maxMarks) };
        }).filter((x: { name: string }) => x.name);
        for (let i = 0; i < subjects.length; i++) {
          await new sql.Request(tx).input("ent", sql.Int, ctx.entityId).input("tid", sql.Int, id)
            .input("name", sql.NVarChar, subjects[i].name).input("max", sql.Float, subjects[i].maxMarks)
            .input("pass", sql.Float, subjects[i].passingMarks).input("pos", sql.Int, i)
            .query("INSERT INTO dbo.TestSubjects (entityId, testId, name, maxMarks, passingMarks, position) VALUES (@ent,@tid,@name,@max,@pass,@pos)");
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

// PATCH /api/tests/:id/publish  { published: boolean }
// Publishing locks marks (edits are refused until unpublished) and marks results
// as final for student/parent-facing views.
router.patch("/:id/publish", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const published = req.body?.published ? 1 : 0;
    const r = await s.apply(pool.request()).input("id", sql.Int, id).input("p", sql.Bit, published)
      .query(`UPDATE dbo.Tests SET published=@p, updatedAt=SYSUTCDATETIME() WHERE id=@id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Test not found" });
    res.json({ published: published === 1 });
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
    let batchClause = "";
    if (test.batchId != null) { request.input("bid", sql.Int, test.batchId); batchClause = "AND e.batchId = @bid"; }
    const roster = await request.query(`
      SELECT s.id AS studentId, s.fullName AS studentName, s.registryId, s.branchId,
        (SELECT MIN(e.batchId) FROM dbo.Enrollments e WHERE e.studentId = s.id AND e.status='active' AND e.courseId = @cid ${batchClause}) AS enrollBatchId
      FROM dbo.Students s
      WHERE s.status='active' ${s.clause}
        AND EXISTS (SELECT 1 FROM dbo.Enrollments e WHERE e.studentId = s.id AND e.status='active' AND e.courseId = @cid ${batchClause})
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

    const testSubjects = test.subjects as { id: number; name: string; maxMarks: number; passingMarks: number }[];
    const base = roster.recordset.map((r: { studentId: number; studentName: string; registryId: string; branchId: number; enrollBatchId: number | null }) => {
      const res = resById.get(r.studentId);
      const has = res !== undefined;
      const absent = has && res!.absent === 1;
      const obtainedMarks = has && !absent ? Number(res!.obtainedMarks) : null;
      const subjMap = marksByStudent.get(r.studentId);
      const subjects = testSubjects.map((su) => {
        const om = has && !absent && subjMap && subjMap.has(su.id) ? Number(subjMap.get(su.id)) : null;
        // A subject with no pass mark set (0) has no bar to clear.
        const passed = om == null ? null : (su.passingMarks <= 0 || om >= su.passingMarks);
        return { subjectId: su.id, name: su.name, maxMarks: su.maxMarks, passingMarks: su.passingMarks, obtainedMarks: om, passed };
      });
      const failedSubjects = subjects.filter((x) => x.passed === false).map((x) => x.name);
      const percentage = obtainedMarks != null && test.totalMarks > 0 ? Math.round((obtainedMarks / test.totalMarks) * 1000) / 10 : null;
      // Overall pass requires clearing the total AND every subject that has a pass mark.
      let passed: boolean | null;
      if (!has) passed = null;
      else if (absent) passed = false;
      else passed = obtainedMarks! >= test.passingMarks && failedSubjects.length === 0;
      return {
        studentId: r.studentId, studentName: r.studentName, registryId: r.registryId, branchId: r.branchId,
        enrollBatchId: r.enrollBatchId ?? null,
        recorded: has, absent, obtainedMarks, percentage, passed,
        grade: absent ? null : gradeFor(percentage, passed),
        failedSubjects, remarks: has ? res!.remarks : null,
        subjects,
        rank: null as number | null, batchRank: null as number | null,
      };
    });

    // Overall rank across the roster + rank within each enrollment batch.
    competitionRank(base, (r, rank) => { r.rank = rank; });
    const byBatch = new Map<number, typeof base>();
    for (const r of base) { const k = r.enrollBatchId ?? 0; if (!byBatch.has(k)) byBatch.set(k, []); byBatch.get(k)!.push(r); }
    for (const grp of byBatch.values()) competitionRank(grp, (r, rank) => { r.batchRank = rank; });

    // Class statistics (recorded, non-absent only).
    const scored = base.filter((r) => !r.absent && r.obtainedMarks != null);
    const avg = (vals: number[]) => vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    const totals = scored.map((r) => r.obtainedMarks!) as number[];
    const stats = {
      count: scored.length,
      passCount: scored.filter((r) => r.passed).length,
      overall: totals.length ? { high: Math.max(...totals), low: Math.min(...totals), avg: avg(totals) } : null,
      perSubject: testSubjects.map((su) => {
        const vals = scored.map((r) => r.subjects.find((x) => x.subjectId === su.id)?.obtainedMarks).filter((v): v is number => v != null);
        return { subjectId: su.id, name: su.name, high: vals.length ? Math.max(...vals) : null, low: vals.length ? Math.min(...vals) : null, avg: avg(vals) };
      }),
    };
    res.json({ test, roster: base, stats });
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
    if (test.published) return res.status(409).json({ error: "Results are published and locked. Unpublish the test to edit marks." });
    const hasSubjects = (test.subjects as unknown[]).length > 0;
    const subjMax = new Map((test.subjects as { id: number; maxMarks: number }[]).map((x) => [x.id, x.maxMarks]));
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
          const sidk = Number(sm.subjectId);
          if (!subjMax.has(sidk)) continue;
          // Clamp each subject's marks to [0, subject max].
          const val = Math.min(Math.max(0, num(sm.marks)), subjMax.get(sidk)!);
          subjMarks.push({ subjectId: sidk, marks: val });
          total += val;
        }
      } else {
        total = Math.min(Math.max(0, num(m.total)), test.totalMarks); // clamp to [0, total]
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
      SELECT t.id AS testId, t.name, t.testDate, t.totalMarks, t.passingMarks, t.published, c.name AS courseName,
             r.obtainedMarks, r.absent, r.remarks
      FROM dbo.TestResults r
      JOIN dbo.Tests t ON t.id = r.testId
      LEFT JOIN dbo.Courses c ON c.id = t.courseId
      WHERE r.studentId = @sid ${s.clause}
      ORDER BY t.testDate DESC NULLS LAST, t.id DESC
    `);
    // Per-subject marks + pass marks for this student's tests → subject-level fail rule.
    const failedByTest = new Map<number, string[]>();
    if (r.recordset.length) {
      const mm = await pool.request().input("sid", sql.Int, id).query(`
        SELECT m.testId, ts.name, ts.passingMarks, m.obtainedMarks
        FROM dbo.TestResultMarks m JOIN dbo.TestSubjects ts ON ts.id = m.subjectId
        WHERE m.studentId = @sid`);
      for (const row of mm.recordset as { testId: number; name: string; passingMarks: number; obtainedMarks: number }[]) {
        if (row.passingMarks > 0 && Number(row.obtainedMarks) < row.passingMarks) {
          if (!failedByTest.has(row.testId)) failedByTest.set(row.testId, []);
          failedByTest.get(row.testId)!.push(row.name);
        }
      }
    }
    const results = r.recordset.map((x: { testId: number; obtainedMarks: number; absent: number; totalMarks: number; passingMarks: number; published: number }) => {
      const absent = x.absent === 1;
      const failedSubjects = failedByTest.get(x.testId) || [];
      const percentage = !absent && x.totalMarks > 0 ? Math.round((Number(x.obtainedMarks) / x.totalMarks) * 1000) / 10 : null;
      const passed = absent ? false : (Number(x.obtainedMarks) >= x.passingMarks && failedSubjects.length === 0);
      return { ...x, published: x.published === 1, absent, percentage, passed: absent || x.obtainedMarks != null ? passed : null, grade: absent ? null : gradeFor(percentage, passed), failedSubjects };
    });
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
    if (test.published) return res.status(409).json({ error: "Results are published and locked. Unpublish the test to import marks." });
    const subjects = test.subjects as { id: number; name: string; maxMarks: number }[];
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
          const val = Math.min(Math.max(0, toNum(g(su.name))), su.maxMarks); // clamp to subject max
          subjMarks.push({ subjectId: su.id, marks: val });
          total += val;
        }
      } else if (!absent) {
        total = Math.min(Math.max(0, toNum(g("marks", "obtained", "obtainedmarks", "total", "score"))), test.totalMarks);
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
