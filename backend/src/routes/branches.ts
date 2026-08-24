import { Router } from "express";
import { getPool, sql } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope } from "../tenant";

const router = Router();

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// List branches of the caller's entity. Branch-scoped users see only the
// branches they are assigned to (the Branches row's own id is the branch id).
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { branchCol: "id" });
    const r = await s.apply(pool.request())
      .query(`SELECT * FROM dbo.Branches WHERE 1=1 ${s.clause} ORDER BY createdAt DESC`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// Create — entity_admin only. Stamped with the caller's entity.
router.post("/", requireRole("entity_admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Branch name is required" });
    const r = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("name", sql.NVarChar, String(b.name).trim())
      .input("city", sql.NVarChar, str(b.city))
      .input("address", sql.NVarChar, str(b.address))
      .input("phone", sql.NVarChar, str(b.phone))
      .input("manager", sql.NVarChar, str(b.manager))
      .input("status", sql.NVarChar, str(b.status) || "active")
      .query(`INSERT INTO dbo.Branches (entityId, name, city, address, phone, manager, status)
              OUTPUT INSERTED.* VALUES (@ent,@name,@city,@address,@phone,@manager,@status)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

// Update — entity_admin only; scoped so one entity can't touch another's branch.
router.put("/:id", requireRole("entity_admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("SELECT * FROM dbo.Branches WHERE id=@id AND entityId=@ent");
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Branch not found" });
    const b = req.body || {};
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("ent", sql.Int, ctx.entityId)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("city", sql.NVarChar, b.city !== undefined ? str(b.city) : cur.city)
      .input("address", sql.NVarChar, b.address !== undefined ? str(b.address) : cur.address)
      .input("phone", sql.NVarChar, b.phone !== undefined ? str(b.phone) : cur.phone)
      .input("manager", sql.NVarChar, b.manager !== undefined ? str(b.manager) : cur.manager)
      .input("status", sql.NVarChar, b.status !== undefined ? (str(b.status) || "active") : cur.status)
      .query(`UPDATE dbo.Branches SET name=@name,city=@city,address=@address,phone=@phone,manager=@manager,status=@status,updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id AND entityId=@ent`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

// Delete — entity_admin only; scoped to the caller's entity.
router.delete("/:id", requireRole("entity_admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("DELETE FROM dbo.Branches WHERE id=@id AND entityId=@ent");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Branch not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
