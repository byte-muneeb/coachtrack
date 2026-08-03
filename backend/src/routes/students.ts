import { Router } from "express";
import { getPool, sql } from "../db";
import { logAudit } from "../audit";

const router = Router();

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

async function nextRegistryId(pool: sql.ConnectionPool): Promise<string> {
  const year = new Date().getFullYear();
  // Use the highest existing numeric suffix for the year (survives deletes).
  const r = await pool
    .request()
    .input("prefix", sql.NVarChar, `CT-${year}-%`)
    .query(
      "SELECT ISNULL(MAX(TRY_CONVERT(INT, PARSENAME(REPLACE(registryId, '-', '.'), 1))), 0) AS mx FROM dbo.Students WHERE registryId LIKE @prefix"
    );
  const mx = r.recordset[0].mx as number;
  return `CT-${year}-${String(mx + 1).padStart(4, "0")}`;
}

// GET /api/students?search=&status=
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const request = pool.request();
    const where: string[] = [];
    if (status && status !== "all") {
      request.input("status", sql.NVarChar, status);
      where.push("status = @status");
    }
    if (search) {
      request.input("search", sql.NVarChar, `%${search}%`);
      where.push(
        "(fullName LIKE @search OR registryId LIKE @search OR course LIKE @search OR phone LIKE @search)"
      );
    }
    const branch = String(req.query.branch || "").trim();
    if (branch && branch !== "all") {
      request.input("branch", sql.Int, Number(branch));
      where.push("branchId = @branch");
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    // outstanding is DERIVED from the voucher ledger, never a stored counter.
    const result = await request.query(
      `SELECT s.*,
         ISNULL((SELECT SUM(v.amount - v.paidAmount) FROM dbo.Vouchers v WHERE v.studentId = s.id), 0) AS outstandingLive
       FROM dbo.Students s ${clause} ORDER BY s.createdAt DESC`
    );
    res.json(result.recordset.map(withLiveOutstanding));
  } catch (e) {
    next(e);
  }
});

// GET /api/students/:id  (numeric id or registryId)
router.get("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const request = pool.request();
    const derived = "ISNULL((SELECT SUM(v.amount - v.paidAmount) FROM dbo.Vouchers v WHERE v.studentId = s.id), 0) AS outstandingLive";
    let query: string;
    if (/^\d+$/.test(id)) {
      request.input("id", sql.Int, Number(id));
      query = `SELECT s.*, ${derived} FROM dbo.Students s WHERE s.id = @id`;
    } else {
      request.input("rid", sql.NVarChar, id);
      query = `SELECT s.*, ${derived} FROM dbo.Students s WHERE s.registryId = @rid`;
    }
    const result = await request.query(query);
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: "Student not found" });
    res.json(withLiveOutstanding(row));
  } catch (e) {
    next(e);
  }
});

// POST /api/students
router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (!b.fullName || !String(b.fullName).trim()) {
      return res.status(400).json({ error: "Full name is required" });
    }
    const registryId = str(b.registryId) || (await nextRegistryId(pool));
    const result = await pool
      .request()
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
      .input("branchId", sql.Int, b.branchId ? Number(b.branchId) : null)
      .query(`
        INSERT INTO dbo.Students
          (registryId, fullName, email, phone, dateOfBirth, address, guardianName,
           guardianRelation, photoUrl, course, batch, commencementDate, status,
           discountPct, scholarship, totalFee, outstanding, notes, branchId)
        OUTPUT INSERTED.*
        VALUES
          (@registryId, @fullName, @email, @phone, @dateOfBirth, @address, @guardianName,
           @guardianRelation, @photoUrl, @course, @batch, @commencementDate, @status,
           @discountPct, @scholarship, @totalFee, @outstanding, @notes, @branchId)
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
router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Students WHERE id = @id");
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Student not found" });

    const b = req.body || {};
    const merged = {
      fullName: b.fullName !== undefined ? String(b.fullName).trim() : cur.fullName,
      email: b.email !== undefined ? str(b.email) : cur.email,
      phone: b.phone !== undefined ? str(b.phone) : cur.phone,
      dateOfBirth: b.dateOfBirth !== undefined ? toDate(b.dateOfBirth) : cur.dateOfBirth,
      address: b.address !== undefined ? str(b.address) : cur.address,
      guardianName: b.guardianName !== undefined ? str(b.guardianName) : cur.guardianName,
      guardianRelation:
        b.guardianRelation !== undefined ? str(b.guardianRelation) : cur.guardianRelation,
      photoUrl: b.photoUrl !== undefined ? str(b.photoUrl) : cur.photoUrl,
      course: b.course !== undefined ? str(b.course) : cur.course,
      batch: b.batch !== undefined ? str(b.batch) : cur.batch,
      commencementDate:
        b.commencementDate !== undefined ? toDate(b.commencementDate) : cur.commencementDate,
      status: b.status !== undefined ? str(b.status) || "active" : cur.status,
      discountPct: b.discountPct !== undefined ? num(b.discountPct) : cur.discountPct,
      scholarship: b.scholarship !== undefined ? num(b.scholarship) : cur.scholarship,
      totalFee: b.totalFee !== undefined ? num(b.totalFee) : cur.totalFee,
      outstanding: b.outstanding !== undefined ? num(b.outstanding) : cur.outstanding,
      notes: b.notes !== undefined ? str(b.notes) : cur.notes,
      branchId: b.branchId !== undefined ? (b.branchId ? Number(b.branchId) : null) : cur.branchId,
    };

    const result = await pool
      .request()
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
      .input("branchId", sql.Int, merged.branchId ?? null)
      .query(`
        UPDATE dbo.Students SET
          fullName=@fullName, email=@email, phone=@phone, dateOfBirth=@dateOfBirth,
          address=@address, guardianName=@guardianName, guardianRelation=@guardianRelation,
          photoUrl=@photoUrl, course=@course, batch=@batch, commencementDate=@commencementDate,
          status=@status, discountPct=@discountPct, scholarship=@scholarship, totalFee=@totalFee,
          outstanding=@outstanding, notes=@notes, branchId=@branchId, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    res.json(result.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/students/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.Students WHERE id = @id");
    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Student not found" });
    await logAudit(req, "delete", "student", id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
