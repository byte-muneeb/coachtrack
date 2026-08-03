import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// GET /api/fees
router.get("/", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT * FROM dbo.FeeComponents ORDER BY createdAt DESC");
    res.json(r.recordset);
  } catch (e) {
    next(e);
  }
});

// POST /api/fees
router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (!b.name || !String(b.name).trim())
      return res.status(400).json({ error: "Fee name is required" });
    const r = await pool.request()
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("category", sql.NVarChar, str(b.category))
      .input("frequency", sql.NVarChar, str(b.frequency))
      .input("amount", sql.Float, num(b.amount))
      .input("description", sql.NVarChar, str(b.description))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .query(`
        INSERT INTO dbo.FeeComponents (name, category, frequency, amount, description, status)
        OUTPUT INSERTED.*
        VALUES (@name, @category, @frequency, @amount, @description, @status)
      `);
    res.status(201).json(r.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// PUT /api/fees/:id
router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT * FROM dbo.FeeComponents WHERE id = @id");
    const cur = existing.recordset[0];
    if (!cur) return res.status(404).json({ error: "Fee not found" });
    const b = req.body || {};
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("category", sql.NVarChar, b.category !== undefined ? str(b.category) : cur.category)
      .input("frequency", sql.NVarChar, b.frequency !== undefined ? str(b.frequency) : cur.frequency)
      .input("amount", sql.Float, b.amount !== undefined ? num(b.amount) : cur.amount)
      .input("description", sql.NVarChar, b.description !== undefined ? str(b.description) : cur.description)
      .input("status", sql.NVarChar, b.status !== undefined ? (str(b.status) || "active") : cur.status)
      .query(`
        UPDATE dbo.FeeComponents SET
          name=@name, category=@category, frequency=@frequency, amount=@amount,
          description=@description, status=@status, updatedAt=SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    res.json(r.recordset[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/fees/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.FeeComponents WHERE id = @id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Fee not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
