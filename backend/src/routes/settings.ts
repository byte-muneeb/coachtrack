import { Router } from "express";
import { getPool, sql, type SqlPool } from "../db";

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

async function readProfile(pool: SqlPool) {
  const r = await pool
    .request()
    .input("k", sql.NVarChar, PROFILE_KEY)
    .query("SELECT settingValue FROM dbo.Settings WHERE settingKey=@k");
  const raw = r.recordset[0]?.settingValue;
  if (!raw) return { ...DEFAULT_PROFILE };
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

// GET /api/settings/profile — institute profile + preferences
router.get("/profile", async (_req, res, next) => {
  try {
    const pool = await getPool();
    res.json(await readProfile(pool));
  } catch (e) {
    next(e);
  }
});

// PUT /api/settings/profile — merge-and-save the profile
router.put("/profile", async (req, res, next) => {
  try {
    const pool = await getPool();
    const current = await readProfile(pool);
    const b = req.body || {};
    // Only accept known keys; coerce to strings.
    const merged: Record<string, string> = { ...current };
    for (const key of Object.keys(DEFAULT_PROFILE)) {
      if (b[key] !== undefined && b[key] !== null) merged[key] = String(b[key]);
    }
    if (!merged.name.trim()) return res.status(400).json({ error: "Institute name is required" });

    await pool
      .request()
      .input("k", sql.NVarChar, PROFILE_KEY)
      .input("v", sql.NVarChar, JSON.stringify(merged))
      .query(`
        INSERT INTO Settings (settingKey, settingValue, updatedAt) VALUES (@k, @v, now())
        ON CONFLICT (settingKey) DO UPDATE SET settingValue = EXCLUDED.settingValue, updatedAt = now();
      `);
    res.json(merged);
  } catch (e) {
    next(e);
  }
});

export default router;
