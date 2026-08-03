import type { Request } from "express";
import { getPool, sql } from "./db";
import type { AuthedRequest } from "./auth";

/** Record an audit entry. Never throws — auditing must not break the request. */
export async function logAudit(
  req: Request, action: string, entity: string,
  entityId: string | number | null, detail?: string
): Promise<void> {
  try {
    const u = (req as AuthedRequest).user;
    const pool = await getPool();
    await pool.request()
      .input("uid", sql.Int, u?.userId ?? null)
      .input("un", sql.NVarChar, u?.username ?? null)
      .input("a", sql.NVarChar, action)
      .input("e", sql.NVarChar, entity)
      .input("eid", sql.NVarChar, entityId == null ? null : String(entityId))
      .input("d", sql.NVarChar, detail ?? null)
      .query("INSERT INTO dbo.AuditLog (userId, username, action, entity, entityId, detail) VALUES (@uid,@un,@a,@e,@eid,@d)");
  } catch { /* swallow */ }
}
