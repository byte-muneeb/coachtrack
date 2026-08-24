import { Router } from "express";
import { getPool, sql, type SqlPool } from "../db";
import { requireRole, type AuthedRequest } from "../auth";

const router = Router();

const PROFILE_KEY = "institute.profile";

// Sensible defaults for a fresh install so the UI always has something to show.
const DEFAULT_PROFILE = {
  name: "My Coaching Centre",
  tagline: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  currency: "PKR",
  academicYear: "",
  voucherPrefix: "CT",
  voucherFooter: "Please pay before the due date to avoid a late fee.",
  logoText: "",
  lateFeeMode: "none", // none | fixed | percent
  lateFeeValue: "0",   // Rs (fixed) or % (percent), applied to overdue balance
  autoGenDay: "0",     // day-of-month for scheduled generation (0 = disabled)
};

async function readProfile(pool: SqlPool, entityId: number | null) {
  const r = await pool
    .request()
    .input("e", sql.Int, entityId)
    .input("k", sql.NVarChar, PROFILE_KEY)
    .query("SELECT settingValue FROM dbo.Settings WHERE entityId=@e AND settingKey=@k");
  const raw = r.recordset[0]?.settingValue;
  if (!raw) return { ...DEFAULT_PROFILE };
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

// GET /api/settings/profile — institute profile + preferences (any entity user)
router.get("/profile", async (req, res, next) => {
  try {
    const pool = await getPool();
    res.json(await readProfile(pool, (req as AuthedRequest).ctx!.entityId));
  } catch (e) {
    next(e);
  }
});

// PUT /api/settings/profile — merge-and-save the profile (entity_admin only)
router.put("/profile", requireRole("entity_admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const entityId = (req as AuthedRequest).ctx!.entityId;
    const current = await readProfile(pool, entityId);
    const b = req.body || {};
    // Only accept known keys; coerce to strings.
    const merged: Record<string, string> = { ...current };
    for (const key of Object.keys(DEFAULT_PROFILE)) {
      if (b[key] !== undefined && b[key] !== null) merged[key] = String(b[key]);
    }
    if (!merged.name.trim()) return res.status(400).json({ error: "Institute name is required" });

    await pool
      .request()
      .input("e", sql.Int, entityId)
      .input("k", sql.NVarChar, PROFILE_KEY)
      .input("v", sql.NVarChar, JSON.stringify(merged))
      .query(`
        INSERT INTO Settings (entityId, settingKey, settingValue, updatedAt) VALUES (@e, @k, @v, now())
        ON CONFLICT (entityId, settingKey) DO UPDATE SET settingValue = EXCLUDED.settingValue, updatedAt = now();
      `);
    res.json(merged);
  } catch (e) {
    next(e);
  }
});

export default router;
