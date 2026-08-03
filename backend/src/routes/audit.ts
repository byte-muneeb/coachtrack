import { Router } from "express";
import { getPool } from "../db";
import { requireRole } from "../auth";

const router = Router();

// GET /api/audit — recent activity (admin only)
router.get("/", requireRole("admin"), async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT TOP 300 * FROM dbo.AuditLog ORDER BY createdAt DESC");
    res.json(r.recordset);
  } catch (e) { next(e); }
});

export default router;
