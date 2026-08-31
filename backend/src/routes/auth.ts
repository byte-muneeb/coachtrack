import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getPool, sql, type SqlPool } from "../db";
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
    // A branch_manager only sees the branch memberships that overlap their own set,
    // never a shared user's full branch list (which may include branches they can't see).
    let aggFilter = "ub.branchId IS NOT NULL";
    if (!ctx.allBranches) {
      request.input("brs", sql.Int, ctx.branchIds.length ? ctx.branchIds : [-1]);
      branchScope = "AND EXISTS (SELECT 1 FROM UserBranches x WHERE x.userId=u.id AND x.branchId = ANY(@brs))";
      aggFilter = "ub.branchId = ANY(@brs)";
    }
    const r = await request.query(`
      SELECT u.id, u.username, u.fullName, u.role, u.status, u.createdAt,
             COALESCE(array_agg(ub.branchId) FILTER (WHERE ${aggFilter}), '{}') AS branchIds
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

// Verify the caller may manage this target user. entity_admin: any user in the
// entity. branch_manager: only non-admin users who share one of their branches.
async function assertCanManageTarget(pool: SqlPool, ctx: AuthedRequest["ctx"], targetId: number, targetRole: string): Promise<string | null> {
  if (ctx!.allBranches) return null;
  if (targetRole === "entity_admin") return "You cannot manage an entity admin";
  const tb = await pool.request().input("uid", sql.Int, targetId)
    .input("brs", sql.Int, ctx!.branchIds.length ? ctx!.branchIds : [-1])
    .query("SELECT COUNT(*) AS c FROM UserBranches WHERE userId=@uid AND branchId = ANY(@brs)");
  return Number(tb.recordset[0].c) === 0 ? "This user is outside your branches" : null;
}

// PUT /api/auth/users/:id — update a user's role/branch set. Entity-scoped; a
// branch_manager may only touch non-admin users within their own branches, may
// not grant entity_admin, and the entity's last admin can never be demoted.
router.put("/users/:id", canManageUsers, async (req, res, next) => {
  const pool = await getPool();
  const ctx = (req as AuthedRequest).ctx!;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const ex = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
    .query("SELECT * FROM dbo.Users WHERE id=@id AND entityId=@ent");
  const cur = ex.recordset[0];
  if (!cur) return res.status(404).json({ error: "User not found" });

  const denied = await assertCanManageTarget(pool, (req as AuthedRequest).ctx, id, cur.role);
  if (denied) return res.status(403).json({ error: denied });

  const b = req.body || {};
  const role = b.role !== undefined && ENTITY_ROLES.includes(b.role) ? b.role : cur.role;
  if (!ctx.allBranches && role === "entity_admin")
    return res.status(403).json({ error: "Only an entity admin can grant the entity_admin role" });

  // Resolve the new branch set up-front so we can validate before writing.
  // null = leave assignments unchanged; [] = entity_admin (covers all branches).
  let branchIds: number[] | null = null;
  if (b.branchIds !== undefined || role === "entity_admin") {
    if (role === "entity_admin") {
      branchIds = [];
    } else {
      let ids: number[] = Array.isArray(b.branchIds) ? b.branchIds.map((x: unknown) => Number(x)).filter((n: number) => !isNaN(n)) : [];
      if (!ctx.allBranches) ids = ids.filter((x) => ctx.branchIds.includes(x));
      if (!ids.length) return res.status(400).json({ error: "Assign at least one branch for this role" });
      const chk = await pool.request().input("ent", sql.Int, ctx.entityId).input("ids", sql.Int, ids)
        .query("SELECT COUNT(*) AS c FROM dbo.Branches WHERE entityId=@ent AND id = ANY(@ids)");
      if (Number(chk.recordset[0].c) !== ids.length)
        return res.status(400).json({ error: "One or more branches are invalid for this entity" });
      branchIds = ids;
    }
  }
  if (b.role === undefined && branchIds === null) return res.json({ ok: true });

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    // Never demote the entity's last active admin (lock admin rows to avoid a race).
    if (cur.role === "entity_admin" && role !== "entity_admin") {
      const admins = await new sql.Request(tx).input("ent", sql.Int, ctx.entityId)
        .query("SELECT id FROM dbo.Users WHERE entityId=@ent AND role='entity_admin' AND status='active' FOR UPDATE");
      if (admins.recordset.length <= 1) { await tx.rollback(); return res.status(400).json({ error: "Cannot demote the last entity admin" }); }
    }
    if (b.role !== undefined)
      await new sql.Request(tx).input("id", sql.Int, id).input("r", sql.NVarChar, role).query("UPDATE dbo.Users SET role=@r WHERE id=@id");
    if (branchIds !== null) {
      await new sql.Request(tx).input("uid", sql.Int, id).query("DELETE FROM UserBranches WHERE userId=@uid");
      for (const bid of branchIds)
        await new sql.Request(tx).input("uid", sql.Int, id).input("bid", sql.Int, bid).query("INSERT INTO UserBranches (userId, branchId) VALUES (@uid,@bid)");
    }
    await tx.commit();
    res.json({ ok: true });
  } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } next(e); }
});

// DELETE /api/auth/users/:id — entity-scoped; branch_manager limited to their own
// non-admin users; the entity's last active admin can never be deleted.
router.delete("/users/:id", canManageUsers, async (req, res, next) => {
  const pool = await getPool();
  const ctx = (req as AuthedRequest).ctx!;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const t = await pool.request().input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
    .query("SELECT role FROM dbo.Users WHERE id=@id AND entityId=@ent");
  const target = t.recordset[0];
  if (!target) return res.status(404).json({ error: "User not found" });
  const denied = await assertCanManageTarget(pool, (req as AuthedRequest).ctx, id, target.role);
  if (denied) return res.status(403).json({ error: denied });

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    if (target.role === "entity_admin") {
      const admins = await new sql.Request(tx).input("ent", sql.Int, ctx.entityId)
        .query("SELECT id FROM dbo.Users WHERE entityId=@ent AND role='entity_admin' AND status='active' FOR UPDATE");
      if (admins.recordset.length <= 1) { await tx.rollback(); return res.status(400).json({ error: "Cannot delete the last entity admin" }); }
    }
    await new sql.Request(tx).input("id", sql.Int, id).input("ent", sql.Int, ctx.entityId)
      .query("DELETE FROM dbo.Users WHERE id=@id AND entityId=@ent");
    await tx.commit();
    res.status(204).end();
  } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } next(e); }
});

export default router;
