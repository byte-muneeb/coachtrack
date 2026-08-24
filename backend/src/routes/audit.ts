import { Router } from "express";
import { getPool } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope } from "../tenant";

const router = Router();

// GET /api/audit — recent activity for the caller's entity (entity_admin only).
// targetType/targetId are aliased back to entity/entityId for the existing UI.
router.get("/", requireRole("entity_admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const r = await s.apply(pool.request()).query(`
      SELECT TOP 300 id, userId, username, impersonatorId, action,
             targetType AS entity, targetId AS entityId, detail, createdAt
      FROM dbo.AuditLog WHERE 1=1 ${s.entityClause} ORDER BY createdAt DESC
    `);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

export default router;
