import type { Request } from "express";
import { getPool, sql } from "./db";
import type { AuthedRequest } from "./auth";

/** Record an audit entry. Never throws — auditing must not break the request. */
export async function logAudit(
  req: Request, action: string, entity: string,
  entityId: string | number | null, detail?: string
): Promise<void> {
  try {
    const areq = req as AuthedRequest;
    const u = areq.user;
    // AuditLog.entityId = tenant; the audited record is targetType/targetId (the
    // function's `entity`/`entityId` params, kept for call-site compatibility).
    const tenantId = areq.ctx?.entityId ?? u?.entityId ?? null;
    const pool = await getPool();
    await pool.request()
      .input("ent", sql.Int, tenantId)
      .input("uid", sql.Int, u?.userId ?? null)
      .input("un", sql.NVarChar, u?.username ?? null)
      .input("imp", sql.Int, u?.impersonatorId ?? null)
      .input("a", sql.NVarChar, action)
      .input("tt", sql.NVarChar, entity)
      .input("tid", sql.NVarChar, entityId == null ? null : String(entityId))
      .input("d", sql.NVarChar, detail ?? null)
      .query("INSERT INTO dbo.AuditLog (entityId, userId, username, impersonatorId, action, targetType, targetId, detail) VALUES (@ent,@uid,@un,@imp,@a,@tt,@tid,@d)");
  } catch { /* swallow */ }
}
