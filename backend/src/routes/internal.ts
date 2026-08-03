import type { Request, Response } from "express";
import { getPool, ensureSchemaOnce, sql } from "../db";
import { generateMonthlyVouchers } from "./vouchers";

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Runs monthly voucher generation IF today matches the configured `autoGenDay`
 * and this month hasn't been generated yet. Idempotent and safe to call often
 * (guarded by the `system.lastAutoGen` setting). Used by both the Vercel cron
 * endpoint and the local dev scheduler.
 */
export async function runAutoGenerateIfDue(): Promise<{
  ran: boolean; reason?: string; month?: string; created?: number;
}> {
  const pool = await getPool();

  const pr = await pool.request().input("k", sql.NVarChar, "institute.profile")
    .query("SELECT settingValue FROM dbo.Settings WHERE settingKey=@k");
  let day = 0;
  try { day = Number(JSON.parse(pr.recordset[0]?.settingValue || "{}").autoGenDay) || 0; } catch { /* ignore */ }
  if (day <= 0) return { ran: false, reason: "autoGenDay not configured" };

  const now = new Date();
  if (now.getDate() !== day) return { ran: false, reason: `today (${now.getDate()}) is not autoGenDay (${day})` };
  const month = ym(now);

  const lr = await pool.request().input("k", sql.NVarChar, "system.lastAutoGen")
    .query("SELECT settingValue FROM dbo.Settings WHERE settingKey=@k");
  if (lr.recordset[0]?.settingValue === month) return { ran: false, reason: "already generated this month", month };

  const dueDate = new Date(`${month}-10`);
  const expiryDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
  const result = await generateMonthlyVouchers(pool, { billingMonth: month, generateDate: now, dueDate, expiryDate });

  await pool.request().input("k", sql.NVarChar, "system.lastAutoGen").input("v", sql.NVarChar, month)
    .query(`MERGE dbo.Settings AS t USING (SELECT @k AS k) s ON t.settingKey=s.k
            WHEN MATCHED THEN UPDATE SET settingValue=@v, updatedAt=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (settingKey,settingValue) VALUES (@k,@v);`);

  return { ran: true, month, created: result.created };
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
