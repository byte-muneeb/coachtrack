import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env.AUTH_SECRET || "coachtrack-dev-secret-change-me";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type Role = "super_admin" | "entity_admin" | "branch_manager" | "accountant" | "front_desk" | "teacher";
// entityId is null only for a super_admin who is NOT impersonating. When a super
// admin impersonates an entity, entityId is that entity and impersonatorId is set.
export type AuthUser = { userId: number; username: string; role: string; entityId: number | null; impersonatorId?: number };
// Per-request tenant context resolved by the tenant middleware (see tenant.ts).
export interface TenantCtx { entityId: number | null; role: string; branchIds: number[]; allBranches: boolean; impersonatorId?: number }
export interface AuthedRequest extends Request { user?: AuthUser; ctx?: TenantCtx }

// --- Password hashing (scrypt, salted) ---
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 32).toString("hex");
  const a = Buffer.from(h); const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Signed token (HMAC-SHA256, no external deps) ---
export function signToken(payload: AuthUser): string {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}
export function verifyToken(token: string): AuthUser | null {
  const [data, sig] = (token || "").split(".");
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!body.exp || body.exp < Date.now()) return null;
    return { userId: body.userId, username: body.username, role: body.role, entityId: body.entityId ?? null, impersonatorId: body.impersonatorId };
  } catch { return null; }
}

// --- Express middleware ---
export function authRequired(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const u = verifyToken(token);
  if (!u) return res.status(401).json({ error: "Authentication required" });
  (req as AuthedRequest).user = u;
  next();
}
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as AuthedRequest).user;
    if (!u) return res.status(401).json({ error: "Authentication required" });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Not permitted for your role" });
    next();
  };
}
