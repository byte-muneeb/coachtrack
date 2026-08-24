import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getPool, sql } from "../db";
import { verifyPassword, signToken, hashPassword, requireRole, type AuthedRequest } from "../auth";

// Roles an entity may assign to its users (super_admin is platform-only).
const ENTITY_ROLES = ["entity_admin", "branch_manager", "accountant", "front_desk", "teacher"];

// Public login handler (mounted directly, outside the auth-required middleware).
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getPool();
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
    const r = await pool.request().input("u", sql.NVarChar, String(username).trim())
      .query("SELECT * FROM dbo.Users WHERE username=@u AND status='active'");
    const user = r.recordset[0];
    if (!user || !verifyPassword(String(password), user.passwordHash))
      return res.status(401).json({ error: "Invalid username or password" });
    // Block login if the user's entity is suspended/deleted (super_admin has no entity).
    if (user.entityId != null) {
      const ent = await pool.request().input("id", sql.Int, user.entityId)
        .query("SELECT status FROM dbo.Entities WHERE id=@id");
      const st = ent.recordset[0]?.status;
      if (st !== "active") return res.status(403).json({ error: "This account's institute is not active. Contact support." });
    }
    const token = signToken({ userId: user.id, username: user.username, role: user.role, entityId: user.entityId ?? null });
    res.json({ token, user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, entityId: user.entityId ?? null } });
  } catch (e) { next(e); }
}

// Protected routes (mounted at /api/auth under authRequired + tenantContext).
const router = Router();

router.get("/me", (req, res) => {
  const areq = req as AuthedRequest;
  res.json({ ...areq.user, branchIds: areq.ctx?.branchIds ?? [], allBranches: areq.ctx?.allBranches ?? false });
});

// User management: entity_admin (whole entity) or branch_manager (their branches).
const canManageUsers = requireRole("entity_admin", "branch_manager");

// GET /api/auth/users — users in the caller's entity (branch_manager: only users
// who share one of their branches). Each row includes its branchIds[].
router.get("/users", canManageUsers, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const request = pool.request().input("ent", sql.Int, ctx.entityId);
    let branchScope = "";
    if (!ctx.allBranches) {
      request.input("brs", sql.Int, ctx.branchIds.length ? ctx.branchIds : [-1]);
      branchScope = "AND EXISTS (SELECT 1 FROM UserBranches x WHERE x.userId=u.id AND x.branchId = ANY(@brs))";
    }
    const r = await request.query(`
      SELECT u.id, u.username, u.fullName, u.role, u.status, u.createdAt,
             COALESCE(array_agg(ub.branchId) FILTER (WHERE ub.branchId IS NOT NULL), '{}') AS branchIds
      FROM dbo.Users u
      LEFT JOIN UserBranches ub ON ub.userId = u.id
      WHERE u.entityId = @ent ${branchScope}
      GROUP BY u.id, u.username, u.fullName, u.role, u.status, u.createdAt
      ORDER BY u.createdAt
    `);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// POST /api/auth/users — create a user in the entity with a role + branch set.
router.post("/users", canManageUsers, async (req, res, next) => {
  const pool = await getPool();
  const ctx = (req as AuthedRequest).ctx!;
  const b = req.body || {};
  if (!b.username || !b.password) return res.status(400).json({ error: "username and password are required" });
  if (String(b.password).length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });
  const role = ENTITY_ROLES.includes(b.role) ? b.role : "accountant";

  // branch_manager cannot create entity_admins.
  if (!ctx.allBranches && role === "entity_admin")
    return res.status(403).json({ error: "Only an entity admin can create another entity admin" });

  // Resolve the branch set. entity_admin role covers all branches (no rows needed).
  let branchIds: number[] = [];
  if (role !== "entity_admin") {
    branchIds = Array.isArray(b.branchIds) ? b.branchIds.map((x: unknown) => Number(x)).filter((n: number) => !isNaN(n)) : [];
    if (!ctx.allBranches) {
      // A branch_manager may only assign branches from their own set.
      branchIds = branchIds.filter((id) => ctx.branchIds.includes(id));
      if (!branchIds.length) branchIds = [...ctx.branchIds];
    }
    if (!branchIds.length) return res.status(400).json({ error: "Assign at least one branch for this role" });
    // Validate the branches belong to this entity.
    const chk = await pool.request().input("ent", sql.Int, ctx.entityId).input("ids", sql.Int, branchIds)
      .query("SELECT COUNT(*) AS c FROM dbo.Branches WHERE entityId=@ent AND id = ANY(@ids)");
    if (Number(chk.recordset[0].c) !== branchIds.length)
      return res.status(400).json({ error: "One or more branches are invalid for this entity" });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const ins = await new sql.Request(tx)
      .input("ent", sql.Int, ctx.entityId)
      .input("u", sql.NVarChar, String(b.username).trim())
      .input("p", sql.NVarChar, hashPassword(String(b.password)))
      .input("n", sql.NVarChar, b.fullName ? String(b.fullName).trim() : null)
      .input("r", sql.NVarChar, role)
      .query(`INSERT INTO dbo.Users (entityId, username, passwordHash, fullName, role, status)
              OUTPUT INSERTED.id, INSERTED.username, INSERTED.fullName, INSERTED.role, INSERTED.status
              VALUES (@ent,@u,@p,@n,@r,'active')`);
    const user = ins.recordset[0];
    for (const bid of branchIds) {
      await new sql.Request(tx).input("uid", sql.Int, user.id).input("bid", sql.Int, bid)
        .query("INSERT INTO UserBranches (userId, branchId) VALUES (@uid,@bid)");
    }
    await tx.commit();
    res.status(201).json({ ...user, branchIds });
  } catch (e: unknown) {
    try { await tx.rollback(); } catch { /* ignore */ }
    if ((e as { number?: number }).number === 2627) return res.status(409).json({ error: "Username already exists" });
    next(e);
  }
});

// PUT /api/auth/users/:id — update a user's role/branch set (entity-scoped).
router.put("/users/:id", canManageUsers, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("SELECT * FROM dbo.Users WHERE id=@id AND entityId=@ent");
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "User not found" });
    const b = req.body || {};
    const role = b.role !== undefined && ENTITY_ROLES.includes(b.role) ? b.role : cur.role;
    if (!ctx.allBranches && role === "entity_admin")
      return res.status(403).json({ error: "Only an entity admin can grant the entity_admin role" });

    if (b.role !== undefined || b.branchIds !== undefined) {
      await pool.request().input("id", sql.Int, id).input("r", sql.NVarChar, role).query("UPDATE dbo.Users SET role=@r WHERE id=@id");
      // Reset branch assignments if provided (or when role becomes entity_admin).
      if (b.branchIds !== undefined || role === "entity_admin") {
        await pool.request().input("uid", sql.Int, id).query("DELETE FROM UserBranches WHERE userId=@uid");
        if (role !== "entity_admin") {
          let branchIds: number[] = Array.isArray(b.branchIds) ? b.branchIds.map((x: unknown) => Number(x)).filter((n: number) => !isNaN(n)) : [];
          if (!ctx.allBranches) branchIds = branchIds.filter((x) => ctx.branchIds.includes(x));
          const chk = await pool.request().input("ent", sql.Int, ctx.entityId).input("ids", sql.Int, branchIds.length ? branchIds : [-1])
            .query("SELECT COUNT(*) AS c FROM dbo.Branches WHERE entityId=@ent AND id = ANY(@ids)");
          if (Number(chk.recordset[0].c) !== branchIds.length)
            return res.status(400).json({ error: "One or more branches are invalid for this entity" });
          for (const bid of branchIds) {
            await pool.request().input("uid", sql.Int, id).input("bid", sql.Int, bid)
              .query("INSERT INTO UserBranches (userId, branchId) VALUES (@uid,@bid)");
          }
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/auth/users/:id — entity-scoped; never remove the last entity_admin.
router.delete("/users/:id", canManageUsers, async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const id = Number(req.params.id);
    const target = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("SELECT role FROM dbo.Users WHERE id=@id AND entityId=@ent");
    if (!target.recordset[0]) return res.status(404).json({ error: "User not found" });
    if (target.recordset[0].role === "entity_admin") {
      const admins = await pool.request().input("ent", sql.Int, ctx.entityId)
        .query("SELECT COUNT(*) AS c FROM dbo.Users WHERE entityId=@ent AND role='entity_admin' AND status='active'");
      if (Number(admins.recordset[0].c) <= 1) return res.status(400).json({ error: "Cannot delete the last entity admin" });
    }
    await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("DELETE FROM dbo.Users WHERE id=@id AND entityId=@ent");
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
