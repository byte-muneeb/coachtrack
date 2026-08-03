import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

router.get("/", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT * FROM dbo.Branches ORDER BY createdAt DESC");
    res.json(r.recordset);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Branch name is required" });
    const r = await pool.request()
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("city", sql.NVarChar, str(b.city))
      .input("address", sql.NVarChar, str(b.address))
      .input("phone", sql.NVarChar, str(b.phone))
      .input("manager", sql.NVarChar, str(b.manager))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .query(`INSERT INTO dbo.Branches (name, city, address, phone, manager, status)
              OUTPUT INSERTED.* VALUES (@name,@city,@address,@phone,@manager,@status)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.Branches WHERE id=@id");
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Branch not found" });
    const b = req.body || {};
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("city", sql.NVarChar, b.city !== undefined ? str(b.city) : cur.city)
      .input("address", sql.NVarChar, b.address !== undefined ? str(b.address) : cur.address)
      .input("phone", sql.NVarChar, b.phone !== undefined ? str(b.phone) : cur.phone)
      .input("manager", sql.NVarChar, b.manager !== undefined ? str(b.manager) : cur.manager)
      .input("status", sql.NVarChar, b.status !== undefined ? (str(b.status) || "active") : cur.status)
      .query(`UPDATE dbo.Branches SET name=@name,city=@city,address=@address,phone=@phone,manager=@manager,status=@status,updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Branches WHERE id=@id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Branch not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
