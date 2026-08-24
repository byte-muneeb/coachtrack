import type { Request, Response } from "express";
import { getPool, ensureSchemaOnce, sql } from "../db";
import { generateMonthlyVouchers } from "./vouchers";

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Runs monthly voucher generation for EVERY active entity whose configured
 * `autoGenDay` is today and which hasn't been generated this month yet.
 * Idempotent per entity (guarded by each entity's `system.lastAutoGen` setting).
 * Used by both the Vercel cron endpoint and the local dev scheduler.
 */
export async function runAutoGenerateIfDue(): Promise<{
  ran: boolean; month: string; created: number; entities: { entityId: number; created: number }[];
}> {
  const pool = await getPool();
  const now = new Date();
  const today = now.getDate();
  const month = ym(now);

  const ents = await pool.request().query("SELECT id FROM dbo.Entities WHERE status='active'");
  const results: { entityId: number; created: number }[] = [];

  for (const e of ents.recordset) {
    const entityId = e.id as number;

    const pr = await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, "institute.profile")
      .query("SELECT settingValue FROM dbo.Settings WHERE entityId=@e AND settingKey=@k");
    let day = 0;
    try { day = Number(JSON.parse(pr.recordset[0]?.settingValue || "{}").autoGenDay) || 0; } catch { /* ignore */ }
    if (day <= 0 || today !== day) continue;

    const lr = await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, "system.lastAutoGen")
      .query("SELECT settingValue FROM dbo.Settings WHERE entityId=@e AND settingKey=@k");
    if (lr.recordset[0]?.settingValue === month) continue; // already generated this month

    const dueDate = new Date(`${month}-10`);
    const expiryDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
    const result = await generateMonthlyVouchers(pool, { entityId, billingMonth: month, generateDate: now, dueDate, expiryDate });

    await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, "system.lastAutoGen").input("v", sql.NVarChar, month)
      .query(`INSERT INTO dbo.Settings (entityId, settingKey, settingValue, updatedAt) VALUES (@e, @k, @v, now())
              ON CONFLICT (entityId, settingKey) DO UPDATE SET settingValue=EXCLUDED.settingValue, updatedAt=now();`);

    results.push({ entityId, created: result.created });
  }

  const created = results.reduce((a, r) => a + r.created, 0);
  return { ran: results.length > 0, month, created, entities: results };
}

/**
 * Vercel Cron entrypoint (mounted at POST /api/internal/auto-generate, public
 * path). When CRON_SECRET is set, Vercel sends it as a Bearer token — we reject
 * anything that doesn't match, so the endpoint can't be triggered by outsiders.
 */
export async function autoGenerateHandler(req: Request, res: Response) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  }
  try {
    await ensureSchemaOnce();
    const out = await runAutoGenerateIfDue();
    res.json(out);
  } catch (e) {
    console.error("auto-generate failed:", e);
    res.status(500).json({ error: "auto-generate failed" });
  }
}
