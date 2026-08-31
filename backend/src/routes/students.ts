import { Router } from "express";
import { getPool, sql, type SqlPool } from "../db";
import { logAudit } from "../audit";
import { requireRole, type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";
import { MAX_IMPORT_ROWS, rowGetter, lc, trimStr, toNum, toDateStr, type ImportResult } from "../importUtils";

const router = Router();
const canWrite = requireRole("entity_admin", "branch_manager", "front_desk");

// POST /api/students/import — bulk create students from parsed CSV/XLSX rows.
// Course is matched case-insensitively to an EXISTING course (else the row
// errors). Duplicates (registryId or phone already present) are skipped.
// registryId is auto-generated per entity when blank. validateOnly = dry run.
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

    // Existing courses (entity) → case-insensitive name match to canonical name.
    const cRes = await pool.request().input("ent", sql.Int, ctx.entityId).query("SELECT name FROM dbo.Courses WHERE entityId=@ent");
    const courseMap = new Map<string, string>(cRes.recordset.map((c: { name: string }) => [lc(c.name), c.name]));

    // Existing students (entity) for duplicate detection.
    const sRes = await pool.request().input("ent", sql.Int, ctx.entityId).query("SELECT registryId, phone FROM dbo.Students WHERE entityId=@ent");
    const regSet = new Set<string>(sRes.recordset.map((s: { registryId: string }) => lc(s.registryId)));
    const phoneSet = new Set<string>(sRes.recordset.filter((s: { phone: string | null }) => s.phone).map((s: { phone: string }) => lc(s.phone)));

    // Branches in scope for optional per-row `branch` override.
    const bs = scope(ctx, { branchCol: "id" });
    const brRes = await bs.apply(pool.request()).query(`SELECT id, name FROM dbo.Branches WHERE 1=1 ${bs.clause}`);
    const branchMap = new Map<string, number>(brRes.recordset.map((b: { id: number; name: string }) => [lc(b.name), b.id]));

    // Registry auto-numbering seed (per entity, current year).
    const year = new Date().getFullYear();
    const mxRes = await pool.request().input("ent", sql.Int, ctx.entityId).input("prefix", sql.NVarChar, `CT-${year}-%`)
      .query("SELECT COALESCE(MAX(CASE WHEN regexp_replace(registryId,'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(registryId,'^.*-','')::int END),0) AS mx FROM Students WHERE entityId=@ent AND registryId LIKE @prefix");
    let seq = mxRes.recordset[0].mx as number;

    const result: ImportResult = { validateOnly, total: rows.length, created: 0, skipped: [], errors: [] };
    const seenReg = new Set<string>();
    const seenPhone = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const g = rowGetter(rows[i]);
      const rn = i + 2;
      const fullName = trimStr(g("fullname", "name", "studentname"));
      if (!fullName) { result.errors.push({ row: rn, reason: "Missing full name" }); continue; }

      // Course: if provided, must match an existing course (case-insensitive).
      let courseName: string | null = null;
      const cCell = trimStr(g("course", "coursename"));
      if (cCell) {
        const canon = courseMap.get(lc(cCell));
        if (!canon) { result.errors.push({ row: rn, reason: `Course "${cCell}" not found — upload courses first` }); continue; }
        courseName = canon;
      }

      // Branch override by name.
      let branchId = defaultBranch;
      const brName = trimStr(g("branch", "campus"));
      if (brName) {
        const bid = branchMap.get(lc(brName));
        if (!bid) { result.errors.push({ row: rn, reason: `Branch "${brName}" not found` }); continue; }
        branchId = bid;
      }

      // Duplicate detection (phone).
      const phone = trimStr(g("phone", "mobile", "contact", "phonenumber"));
      if (phone && (phoneSet.has(lc(phone)) || seenPhone.has(lc(phone)))) {
        result.skipped.push({ row: rn, reason: `Phone ${phone} already exists` }); continue;
      }

      // Registry id: provided (dedupe) or auto-generated.
      let registryId = trimStr(g("registryid", "regno", "rollno", "roll", "registrationno"));
      if (registryId) {
        if (regSet.has(lc(registryId)) || seenReg.has(lc(registryId))) {
          result.skipped.push({ row: rn, reason: `Registry ID ${registryId} already exists` }); continue;
        }
      } else {
        seq += 1;
        registryId = `CT-${year}-${String(seq).padStart(4, "0")}`;
      }

      seenReg.add(lc(registryId));
      if (phone) seenPhone.add(lc(phone));

      if (!validateOnly) {
        await pool.request()
          .input("ent", sql.Int, ctx.entityId).input("branch", sql.Int, branchId)
          .input("rid", sql.NVarChar, registryId).input("name", sql.NVarChar, fullName)
          .input("email", sql.NVarChar, trimStr(g("email")))
          .input("phone", sql.NVarChar, phone)
          .input("dob", sql.Date, toDateStr(g("dateofbirth", "dob")))
          .input("addr", sql.NVarChar, trimStr(g("address")))
          .input("gname", sql.NVarChar, trimStr(g("guardianname", "guardian", "parentname", "fathername")))
          .input("grel", sql.NVarChar, trimStr(g("guardianrelation", "relation")))
          .input("course", sql.NVarChar, courseName)
          .input("batch", sql.NVarChar, trimStr(g("batch")))
          .input("comm", sql.Date, toDateStr(g("commencementdate", "joindate", "admissiondate")))
          .input("status", sql.NVarChar, trimStr(g("status")) || "active")
          .input("disc", sql.Float, toNum(g("discountpct", "discount")))
          .input("schol", sql.Float, toNum(g("scholarship")))
          .input("notes", sql.NVarChar, trimStr(g("notes")))
          .query(`INSERT INTO dbo.Students
                    (entityId, branchId, registryId, fullName, email, phone, dateOfBirth, address, guardianName, guardianRelation, course, batch, commencementDate, status, discountPct, scholarship, notes)
                  VALUES (@ent,@branch,@rid,@name,@email,@phone,@dob,@addr,@gname,@grel,@course,@batch,@comm,@status,@disc,@schol,@notes)`);
      }
      result.created += 1;
    }
    res.json(result);
  } catch (e) { next(e); }
});

// Replace the stored `outstanding` with the derived voucher-ledger value.
function withLiveOutstanding(row: Record<string, unknown>) {
  const { outstandingLive, ...rest } = row;
  return { ...rest, outstanding: Number(outstandingLive ?? 0) };
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Registry numbering is per entity (survives deletes).
async function nextRegistryId(pool: SqlPool, entityId: number): Promise<string> {
  const year = new Date().getFullYear();
  const r = await pool
    .request()
    .input("ent", sql.Int, entityId)
    .input("prefix", sql.NVarChar, `CT-${year}-%`)
    .query(
      "SELECT COALESCE(MAX(CASE WHEN regexp_replace(registryId,'^.*-','') ~ '^[0-9]+$' THEN regexp_replace(registryId,'^.*-','')::int END),0) AS mx FROM Students WHERE entityId=@ent AND registryId LIKE @prefix"
    );
  const mx = r.recordset[0].mx as number;
  return `CT-${year}-${String(mx + 1).padStart(4, "0")}`;
}

// GET /api/students?search=&status=&branch=
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const request = s.apply(pool.request());
    const where: string[] = [];
    const status = String(req.query.status || "").trim();
    if (status && status !== "all") {
      request.input("status", sql.NVarChar, status);
      where.push("status = @status");
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      where.push("(fullName LIKE @search OR registryId LIKE @search OR course LIKE @search OR phone LIKE @search)");
    }
    const branch = String(req.query.branch || "").trim();
    if (branch && branch !== "all") {
      request.input("branch", sql.Int, Number(branch));
      where.push("branchId = @branch");
    }
    const extra = where.length ? "AND " + where.join(" AND ") : "";
    const result = await request.query(
      `SELECT s.*,
         ISNULL((SELECT SUM(v.amount - v.paidAmount) FROM dbo.Vouchers v WHERE v.studentId = s.id), 0) AS outstandingLive
       FROM dbo.Students s WHERE 1=1 ${s.clause} ${extra} ORDER BY s.createdAt DESC`
    );
    res.json(result.recordset.map(withLiveOutstanding));
  } catch (e) { next(e); }
});

// GET /api/students/:id  (numeric id or registryId)
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const { id } = req.params;
    const request = s.apply(pool.request());
    const derived = "ISNULL((SELECT SUM(v.amount - v.paidAmount) FROM dbo.Vouchers v WHERE v.studentId = s.id), 0) AS outstandingLive";
    let query: string;
    if (/^\d+$/.test(id)) {
      request.input("id", sql.Int, Number(id));
      query = `SELECT s.*, ${derived} FROM dbo.Students s WHERE s.id = @id ${s.clause}`;
    } else {
      request.input("rid", sql.NVarChar, id);
      query = `SELECT s.*, ${derived} FROM dbo.Students s WHERE s.registryId = @rid ${s.clause}`;
    }
    const result = await request.query(query);
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: "Student not found" });
    res.json(withLiveOutstanding(row));
  } catch (e) { next(e); }
});

// POST /api/students
router.post("/", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    if (!b.fullName || !String(b.fullName).trim()) {
      return res.status(400).json({ error: "Full name is required" });
    }
    const branchId = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
    if (branchId == null) return res.status(400).json({ error: "A valid branch is required" });
    const registryId = str(b.registryId) || (await nextRegistryId(pool, ctx.entityId!));
    const result = await pool
      .request()
      .input("ent", sql.Int, ctx.entityId)
      .input("branch", sql.Int, branchId)
      .input("registryId", sql.NVarChar, registryId)
      .input("fullName", sql.NVarChar, String(b.fullName).trim())
      .input("email", sql.NVarChar, str(b.email))
      .input("phone", sql.NVarChar, str(b.phone))
      .input("dateOfBirth", sql.Date, toDate(b.dateOfBirth))
      .input("address", sql.NVarChar, str(b.address))
      .input("guardianName", sql.NVarChar, str(b.guardianName))
      .input("guardianRelation", sql.NVarChar, str(b.guardianRelation))
      .input("photoUrl", sql.NVarChar, str(b.photoUrl))
      .input("course", sql.NVarChar, str(b.course))
      .input("batch", sql.NVarChar, str(b.batch))
      .input("commencementDate", sql.Date, toDate(b.commencementDate))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .input("discountPct", sql.Float, num(b.discountPct))
      .input("scholarship", sql.Float, num(b.scholarship))
      .input("totalFee", sql.Float, num(b.totalFee))
      .input("outstanding", sql.Float, num(b.outstanding))
      .input("notes", sql.NVarChar, str(b.notes))
      .query(`
        INSERT INTO dbo.Students
          (entityId, branchId, registryId, fullName, email, phone, dateOfBirth, address, guardianName,
           guardianRelation, photoUrl, course, batch, commencementDate, status,
           discountPct, scholarship, totalFee, outstanding, notes)
        OUTPUT INSERTED.*
        VALUES
          (@ent, @branch, @registryId, @fullName, @email, @phone, @dateOfBirth, @address, @guardianName,
           @guardianRelation, @photoUrl, @course, @batch, @commencementDate, @status,
           @discountPct, @scholarship, @totalFee, @outstanding, @notes)
      `);
    await logAudit(req, "create", "student", result.recordset[0].id, `${result.recordset[0].fullName} (${result.recordset[0].registryId})`);
    res.status(201).json(result.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 2627)
      return res.status(409).json({ error: "Registry ID already exists" });
    next(e);
  }
});

// PUT /api/students/:id
router.put("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const s = scope(ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const existing = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Students WHERE id = @id ${s.clause}`);
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Student not found" });

    const b = req.body || {};
    // Only allow reassigning branch to one within the caller's scope.
    let branchId = cur.branchId;
    if (b.branchId !== undefined) {
      const rb = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
      if (rb == null) return res.status(400).json({ error: "Invalid branch" });
      branchId = rb;
    }
    const merged = {
      fullName: b.fullName !== undefined ? String(b.fullName).trim() : cur.fullName,
      email: b.email !== undefined ? str(b.email) : cur.email,
      phone: b.phone !== undefined ? str(b.phone) : cur.phone,
      dateOfBirth: b.dateOfBirth !== undefined ? toDate(b.dateOfBirth) : cur.dateOfBirth,
      address: b.address !== undefined ? str(b.address) : cur.address,
      guardianName: b.guardianName !== undefined ? str(b.guardianName) : cur.guardianName,
      guardianRelation: b.guardianRelation !== undefined ? str(b.guardianRelation) : cur.guardianRelation,
      photoUrl: b.photoUrl !== undefined ? str(b.photoUrl) : cur.photoUrl,
      course: b.course !== undefined ? str(b.course) : cur.course,
      batch: b.batch !== undefined ? str(b.batch) : cur.batch,
      commencementDate: b.commencementDate !== undefined ? toDate(b.commencementDate) : cur.commencementDate,
      status: b.status !== undefined ? str(b.status) || "active" : cur.status,
      discountPct: b.discountPct !== undefined ? num(b.discountPct) : cur.discountPct,
      scholarship: b.scholarship !== undefined ? num(b.scholarship) : cur.scholarship,
      totalFee: b.totalFee !== undefined ? num(b.totalFee) : cur.totalFee,
      outstanding: b.outstanding !== undefined ? num(b.outstanding) : cur.outstanding,
      notes: b.notes !== undefined ? str(b.notes) : cur.notes,
      branchId,
    };

    const result = await s.apply(pool.request())
      .input("id", sql.Int, id)
      .input("fullName", sql.NVarChar, merged.fullName)
      .input("email", sql.NVarChar, merged.email)
      .input("phone", sql.NVarChar, merged.phone)
      .input("dateOfBirth", sql.Date, merged.dateOfBirth)
      .input("address", sql.NVarChar, merged.address)
      .input("guardianName", sql.NVarChar, merged.guardianName)
      .input("guardianRelation", sql.NVarChar, merged.guardianRelation)
      .input("photoUrl", sql.NVarChar, merged.photoUrl)
      .input("course", sql.NVarChar, merged.course)
      .input("batch", sql.NVarChar, merged.batch)
      .input("commencementDate", sql.Date, merged.commencementDate)
      .input("status", sql.NVarChar, merged.status)
      .input("discountPct", sql.Float, merged.discountPct)
      .input("scholarship", sql.Float, merged.scholarship)
      .input("totalFee", sql.Float, merged.totalFee)
      .input("outstanding", sql.Float, merged.outstanding)
      .input("notes", sql.NVarChar, merged.notes)
      .input("branch", sql.Int, merged.branchId ?? null)
      .query(`
        UPDATE dbo.Students SET
          fullName=@fullName, email=@email, phone=@phone, dateOfBirth=@dateOfBirth,
          address=@address, guardianName=@guardianName, guardianRelation=@guardianRelation,
          photoUrl=@photoUrl, course=@course, batch=@batch, commencementDate=@commencementDate,
          status=@status, discountPct=@discountPct, scholarship=@scholarship, totalFee=@totalFee,
          outstanding=@outstanding, notes=@notes, branchId=@branch, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id ${s.clause}
      `);
    res.json(result.recordset[0]);
  } catch (e) { next(e); }
});

// DELETE /api/students/:id
router.delete("/:id", canWrite, async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.Students WHERE id = @id ${s.clause}`);
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Student not found" });
    await logAudit(req, "delete", "student", id);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
