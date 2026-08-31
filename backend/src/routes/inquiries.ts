import { Router } from "express";
import { getPool, sql, nextNumber, type SqlPool } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";

const router = Router();
const canWrite = requireRole("entity_admin", "branch_manager", "front_desk");

const STAGES = ["new", "contacted", "trial", "enrolled", "lost"];

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
// Registry numbering is per entity — atomic Counters sequence (race-proof).
async function nextRegistryId(pool: SqlPool, entityId: number): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await nextNumber(pool, { entityId, kind: "registry", year, table: "Students", column: "registryId", prefix: `CT-${year}-%` });
  return `CT-${year}-${String(seq).padStart(4, "0")}`;
}

// GET /api/inquiries?stage=&search=
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const request = s.apply(pool.request());
    const where: string[] = [];
    const stage = String(req.query.stage || "").trim();
    if (stage && stage !== "all") { request.input("stage", sql.NVarChar, stage); where.push("stage = @stage"); }
    const search = String(req.query.search || "").trim();
    if (search) { request.input("search", sql.NVarChar, `%${search}%`); where.push("(name LIKE @search OR phone LIKE @search OR interestedCourse LIKE @search)"); }
    const extra = where.length ? "AND " + where.join(" AND ") : "";
    const r = await request.query(`SELECT * FROM dbo.Inquiries WHERE 1=1 ${s.clause} ${extra} ORDER BY createdAt DESC`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/inquiries
router.post("/", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Name is required" });
    const branchId = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
    if (branchId == null) return res.status(400).json({ error: "A valid branch is required" });
    const stage = STAGES.includes(b.stage) ? b.stage : "new";
    const r = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("branch", sql.Int, branchId)
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("phone", sql.NVarChar, str(b.phone))
      .input("email", sql.NVarChar, str(b.email))
      .input("interestedCourse", sql.NVarChar, str(b.interestedCourse))
      .input("source", sql.NVarChar, str(b.source))
      .input("stage", sql.NVarChar, stage)
      .input("trialDate", sql.Date, toDate(b.trialDate))
      .input("followUpDate", sql.Date, toDate(b.followUpDate))
      .input("notes", sql.NVarChar, str(b.notes))
      .query(`INSERT INTO dbo.Inquiries (entityId, branchId, name, phone, email, interestedCourse, source, stage, trialDate, followUpDate, notes)
              OUTPUT INSERTED.* VALUES (@ent,@branch,@name,@phone,@email,@interestedCourse,@source,@stage,@trialDate,@followUpDate,@notes)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

// PUT /api/inquiries/:id (also used for stage moves)
router.put("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await s.apply(pool.request()).input("id", sql.Int, id).query(`SELECT * FROM dbo.Inquiries WHERE id=@id ${s.clause}`);
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Inquiry not found" });
    const b = req.body || {};
    const r = await s.apply(pool.request())
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("phone", sql.NVarChar, b.phone !== undefined ? str(b.phone) : cur.phone)
      .input("email", sql.NVarChar, b.email !== undefined ? str(b.email) : cur.email)
      .input("interestedCourse", sql.NVarChar, b.interestedCourse !== undefined ? str(b.interestedCourse) : cur.interestedCourse)
      .input("source", sql.NVarChar, b.source !== undefined ? str(b.source) : cur.source)
      .input("stage", sql.NVarChar, b.stage !== undefined && STAGES.includes(b.stage) ? b.stage : cur.stage)
      .input("trialDate", sql.Date, b.trialDate !== undefined ? toDate(b.trialDate) : cur.trialDate)
      .input("followUpDate", sql.Date, b.followUpDate !== undefined ? toDate(b.followUpDate) : cur.followUpDate)
      .input("notes", sql.NVarChar, b.notes !== undefined ? str(b.notes) : cur.notes)
      .query(`UPDATE dbo.Inquiries SET name=@name,phone=@phone,email=@email,interestedCourse=@interestedCourse,source=@source,
              stage=@stage,trialDate=@trialDate,followUpDate=@followUpDate,notes=@notes,updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id ${s.clause}`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

// POST /api/inquiries/:id/convert — create a Student from the inquiry, mark enrolled
router.post("/:id/convert", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const s = scope(ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await s.apply(pool.request()).input("id", sql.Int, id).query(`SELECT * FROM dbo.Inquiries WHERE id=@id ${s.clause}`);
    const inq = ex.recordset[0];
    if (!inq) return res.status(404).json({ error: "Inquiry not found" });
    if (inq.convertedStudentId) return res.status(409).json({ error: "Already converted" });

    const registryId = await nextRegistryId(pool, ctx.entityId!);
    const created = await pool.request()
      .input("ent", sql.Int, inq.entityId)
      .input("branch", sql.Int, inq.branchId)
      .input("registryId", sql.NVarChar, registryId)
      .input("fullName", sql.NVarChar, inq.name)
      .input("phone", sql.NVarChar, inq.phone)
      .input("email", sql.NVarChar, inq.email)
      .input("course", sql.NVarChar, inq.interestedCourse)
      .query(`INSERT INTO dbo.Students (entityId, branchId, registryId, fullName, phone, email, course, status)
              OUTPUT INSERTED.* VALUES (@ent,@branch,@registryId,@fullName,@phone,@email,@course,'active')`);
    const student = created.recordset[0];

    await s.apply(pool.request()).input("id", sql.Int, id).input("sid", sql.Int, student.id)
      .query(`UPDATE dbo.Inquiries SET stage='enrolled', convertedStudentId=@sid, updatedAt=SYSUTCDATETIME() WHERE id=@id ${s.clause}`);

    res.status(201).json({ student });
  } catch (e) { next(e); }
});

// DELETE /api/inquiries/:id
router.delete("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id).query(`DELETE FROM dbo.Inquiries WHERE id=@id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Inquiry not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
