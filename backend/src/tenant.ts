// Per-request tenant context + isolation helpers.
//
// `tenantContext` runs after `authRequired` and resolves the caller's entity and
// branch scope onto `req.ctx`. Routes then use `scope()` to build the WHERE
// fragments that enforce isolation, and `resolveWriteBranch` when inserting.
import type { Response, NextFunction } from "express";
import { getPool, sql } from "./db";
import type { AuthedRequest, TenantCtx } from "./auth";

const ENTITY_ADMIN_ROLES = new Set(["entity_admin", "super_admin"]); // see all branches of the entity

// Resolve tenant context from the authenticated user. MUST run after authRequired.
export async function tenantContext(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const u = req.user;
    if (!u) { res.status(401).json({ error: "Authentication required" }); return; }

    let branchIds: number[] = [];
    let allBranches = false;

    if (ENTITY_ADMIN_ROLES.has(u.role)) {
      // entity_admin (and an impersonating super_admin) see every branch of the entity.
      allBranches = true;
    } else if (u.entityId != null) {
      // Branch-scoped role: load the user's assigned branch set.
      const pool = await getPool();
      const r = await pool.request().input("uid", sql.Int, u.userId)
        .query("SELECT branchId FROM UserBranches WHERE userId=@uid");
      branchIds = r.recordset.map((x: { branchId: number }) => x.branchId);
    }

    req.ctx = {
      entityId: u.entityId,
      role: u.role,
      branchIds,
      allBranches,
      impersonatorId: u.impersonatorId,
    };
    next();
  } catch (e) { next(e); }
}

// Data routes require an entity scope. A super_admin that is NOT impersonating has
// entityId === null and therefore cannot touch tenant data.
export function requireEntity(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.ctx || req.ctx.entityId == null) {
    res.status(403).json({ error: "No entity context for this request" });
    return;
  }
  next();
}

// --- Query-building helpers (used by routes in the isolation pass) ---
//
// Usage in a route:
//   const s = scope(req.ctx);                             // for branch-level tables
//   const r = await s.apply(pool.request()).query(`SELECT * FROM Students WHERE 1=1 ${s.clause}`);
// `clause` always includes `AND entityId = @__entityId`, and for branch-scoped
// users also `AND branchId = ANY(@__branchIds)`. `apply` binds the params.

export interface Scope {
  clause: string;                       // for branch-level tables (entity + branch)
  entityClause: string;                 // for entity-level tables (entity only)
  apply<R extends { input: (n: string, t: unknown, v: unknown) => R }>(r: R): R;
}

export function scope(ctx: TenantCtx | undefined, opts?: { branchCol?: string; entityCol?: string }): Scope {
  const entityCol = opts?.entityCol ?? "entityId";
  const branchCol = opts?.branchCol ?? "branchId";
  const entityId = ctx?.entityId ?? -1; // -1 can never match a real row
  const entityClause = ` AND ${entityCol} = @__entityId`;

  let branchPart = "";
  const restrictBranch = !!ctx && !ctx.allBranches;
  if (restrictBranch) {
    branchPart = ctx!.branchIds.length ? ` AND ${branchCol} = ANY(@__branchIds)` : " AND 1=0";
  }

  return {
    entityClause,
    clause: entityClause + branchPart,
    apply(r) {
      r.input("__entityId", sql.Int, entityId);
      if (restrictBranch && ctx!.branchIds.length) r.input("__branchIds", sql.Int, ctx!.branchIds);
      return r;
    },
  };
}

// Default branch to stamp on inserts for a branch-scoped user (their first branch)
// or a caller-provided branchId that must be validated against their scope.
export function resolveWriteBranch(ctx: TenantCtx | undefined, requested?: number | null): number | null {
  if (!ctx) return null;
  if (requested != null) {
    if (ctx.allBranches || ctx.branchIds.includes(requested)) return requested;
    return null; // requested a branch outside the user's scope → caller should 403
  }
  if (ctx.branchIds.length) return ctx.branchIds[0];
  return null; // entity_admin must specify a branch explicitly
}
