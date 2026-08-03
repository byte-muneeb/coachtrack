import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getPool, sql } from "../db";
import { verifyPassword, signToken, hashPassword, requireRole, type AuthedRequest } from "../auth";

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
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    res.json({ token, user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role } });
  } catch (e) { next(e); }
}

// Protected routes (mounted at /api/auth under authRequired).
const router = Router();

router.get("/me", (req, res) => {
  res.json((req as AuthedRequest).user);
});

router.get("/users", requireRole("admin"), async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT id, username, fullName, role, status, createdAt FROM dbo.Users ORDER BY createdAt");
    res.json(r.recordset);
  } catch (e) { next(e); }
});

router.post("/users", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (!b.username || !b.password) return res.status(400).json({ error: "username and password are required" });
    const role = ["admin", "accountant", "receptionist"].includes(b.role) ? b.role : "accountant";
    const r = await pool.request()
      .input("u", sql.NVarChar, String(b.username).trim())
      .input("p", sql.NVarChar, hashPassword(String(b.password)))
      .input("n", sql.NVarChar, b.fullName || null)
      .input("r", sql.NVarChar, role)
      .query("INSERT INTO dbo.Users (username, passwordHash, fullName, role) OUTPUT INSERTED.id, INSERTED.username, INSERTED.fullName, INSERTED.role, INSERTED.status VALUES (@u,@p,@n,@r)");
    res.status(201).json(r.recordset[0]);
  } catch (e: unknown) {
    if ((e as { number?: number }).number === 2627) return res.status(409).json({ error: "Username already exists" });
    next(e);
  }
});

router.delete("/users/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    // never delete the last admin
    const admins = await pool.request().query("SELECT COUNT(*) AS c FROM dbo.Users WHERE role='admin' AND status='active'");
    const target = await pool.request().input("id", sql.Int, id).query("SELECT role FROM dbo.Users WHERE id=@id");
    if (target.recordset[0]?.role === "admin" && (admins.recordset[0].c as number) <= 1)
      return res.status(400).json({ error: "Cannot delete the last admin" });
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Users WHERE id=@id");
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
