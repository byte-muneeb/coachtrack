// Super-admin (platform vendor) module. Mounted at /api/admin, gated to
// role super_admin. Manages entities (tenants), creates each entity's first
// admin + Main branch, suspends/soft-deletes, and issues impersonation tokens.
import { Router } from "express";
import { getPool, sql } from "../db";
import { hashPassword, signToken, type AuthedRequest } from "../auth";
import { logAudit } from "../audit";

const router = Router();

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function slugify(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// GET /api/admin/entities — all entities with user/student counts.
router.get("/entities", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT e.*,
        (SELECT COUNT(*) FROM Users u WHERE u.entityId = e.id) AS userCount,
        (SELECT COUNT(*) FROM Students s WHERE s.entityId = e.id) AS studentCount
      FROM dbo.Entities e WHERE e.status <> 'deleted' ORDER BY e.createdAt DESC
    `);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/admin/entities — create entity + Main branch + first entity_admin.
router.post("/entities", async (req, res, next) => {
  const pool = await getPool();
  const b = req.body || {};
  const name = str(b.name);
  const adminUsername = str(b.adminUsername);
  const adminPassword = b.adminPassword ? String(b.adminPassword) : "";
  if (!name) return res.status(400).json({ error: "Entity name is required" });
  if (!adminUsername || adminPassword.length < 6)
    return res.status(400).json({ error: "adminUsername and a password (min 6 chars) are required" });
  const slug = str(b.slug) ? slugify(String(b.slug)) : slugify(name);
  if (!slug) return res.status(400).json({ error: "Could not derive a slug; provide one" });

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const ent = await new sql.Request(tx)
      .input("name", sql.NVarChar, name)
      .input("slug", sql.NVarChar, slug)
      .input("phone", sql.NVarChar, str(b.contactPhone))
      .input("email", sql.NVarChar, str(b.contactEmail))
      .query(`INSERT INTO dbo.Entities (name, slug, status, contactPhone, contactEmail)
              OUTPUT INSERTED.* VALUES (@name, @slug, 'active', @phone, @email)`);
    const entity = ent.recordset[0];

    const br = await new sql.Request(tx)
      .input("ent", sql.Int, entity.id)
      .query(`INSERT INTO dbo.Branches (entityId, name, isPrimary, status)
              OUTPUT INSERTED.* VALUES (@ent, 'Main Branch', 1, 'active')`);

    const usr = await new sql.Request(tx)
      .input("ent", sql.Int, entity.id)
      .input("u", sql.NVarChar, adminUsername)
      .input("p", sql.NVarChar, hashPassword(adminPassword))
      .input("n", sql.NVarChar, str(b.adminFullName) || "Administrator")
      .query(`INSERT INTO dbo.Users (entityId, username, passwordHash, fullName, role, status)
              OUTPUT INSERTED.id, INSERTED.username, INSERTED.fullName, INSERTED.role
              VALUES (@ent, @u, @p, @n, 'entity_admin', 'active')`);

    await tx.commit();
    await logAudit(req, "create", "entity", entity.id, `Created entity "${name}" with admin ${adminUsername}`);
    res.status(201).json({ entity, mainBranch: br.recordset[0], admin: usr.recordset[0] });
  } catch (e: unknown) {
    try { await tx.rollback(); } catch { /* ignore */ }
    if ((e as { number?: number }).number === 2627)
      return res.status(409).json({ error: "That entity slug or admin username is already taken" });
    next(e);
  }
});

// PATCH /api/admin/entities/:id — update name/contact/status (suspend/reactivate).
router.patch("/entities/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.Entities WHERE id=@id");
    const cur = ex.recordset[0];
    if (!cur || cur.status === "deleted") return res.status(404).json({ error: "Entity not found" });
    const b = req.body || {};
    if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: "Entity name is required" });
    const status = ["active", "suspended"].includes(b.status) ? b.status : cur.status;
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, b.name !== undefined ? String(b.name).trim() : cur.name)
      .input("phone", sql.NVarChar, b.contactPhone !== undefined ? str(b.contactPhone) : cur.contactPhone)
      .input("email", sql.NVarChar, b.contactEmail !== undefined ? str(b.contactEmail) : cur.contactEmail)
      .input("status", sql.NVarChar, status)
      .query(`UPDATE dbo.Entities SET name=@name, contactPhone=@phone, contactEmail=@email, status=@status, updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id`);
    await logAudit(req, "update", "entity", id, `status=${status}`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

// DELETE /api/admin/entities/:id — soft delete (status='deleted'; data retained).
router.delete("/entities/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.Entities SET status='deleted', updatedAt=SYSUTCDATETIME() WHERE id=@id AND status <> 'deleted'");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Entity not found" });
    await logAudit(req, "delete", "entity", id, "soft-deleted");
    res.status(204).end();
  } catch (e) { next(e); }
});

// POST /api/admin/entities/:id/impersonate — get an entity-scoped token (full
// edit, audited). The token carries impersonatorId = the super admin's id.
router.post("/entities/:id/impersonate", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ent = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.Entities WHERE id=@id");
    const entity = ent.recordset[0];
    if (!entity || entity.status === "deleted") return res.status(404).json({ error: "Entity not found" });
    const su = (req as AuthedRequest).user!;
    const token = signToken({ userId: su.userId, username: su.username, role: "entity_admin", entityId: id, impersonatorId: su.userId });
    await logAudit(req, "impersonate", "entity", id, `super admin ${su.username} entered "${entity.name}"`);
    res.json({ token, entity, impersonating: true });
  } catch (e) { next(e); }
});

export default router;
