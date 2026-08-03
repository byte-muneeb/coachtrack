import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

const DEFAULT_TEMPLATE =
  "Dear Parent, this is a reminder that {StudentName}'s fee of Rs {Amount} is due on {DueDate}. Please pay on time to avoid interruption. - CoachTrack";

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function intOr0(v: unknown): number { const n = parseInt(String(v), 10); return isNaN(n) ? 0 : n; }

// ---- Rules ----
router.get("/rules", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT * FROM dbo.ReminderRules ORDER BY offsetType, offsetDays");
    res.json(r.recordset.map((x) => ({ ...x, active: !!x.active })));
  } catch (e) { next(e); }
});

router.post("/rules", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    const offsetType = ["before", "on", "after"].includes(b.offsetType) ? b.offsetType : "before";
    const r = await pool.request()
      .input("offsetType", sql.NVarChar, offsetType)
      .input("offsetDays", sql.Int, offsetType === "on" ? 0 : intOr0(b.offsetDays))
      .input("channels", sql.NVarChar, str(b.channels))
      .input("active", sql.Bit, b.active === false ? 0 : 1)
      .query(`INSERT INTO dbo.ReminderRules (offsetType, offsetDays, channels, active)
              OUTPUT INSERTED.* VALUES (@offsetType,@offsetDays,@channels,@active)`);
    const row = r.recordset[0];
    res.status(201).json({ ...row, active: !!row.active });
  } catch (e) { next(e); }
});

router.put("/rules/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.ReminderRules WHERE id=@id");
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Rule not found" });
    const b = req.body || {};
    const offsetType = b.offsetType !== undefined && ["before", "on", "after"].includes(b.offsetType) ? b.offsetType : cur.offsetType;
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("offsetType", sql.NVarChar, offsetType)
      .input("offsetDays", sql.Int, b.offsetDays !== undefined ? (offsetType === "on" ? 0 : intOr0(b.offsetDays)) : cur.offsetDays)
      .input("channels", sql.NVarChar, b.channels !== undefined ? str(b.channels) : cur.channels)
      .input("active", sql.Bit, b.active !== undefined ? (b.active ? 1 : 0) : cur.active)
      .query(`UPDATE dbo.ReminderRules SET offsetType=@offsetType, offsetDays=@offsetDays, channels=@channels, active=@active, updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id`);
    const row = r.recordset[0];
    res.json({ ...row, active: !!row.active });
  } catch (e) { next(e); }
});

router.delete("/rules/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.ReminderRules WHERE id=@id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Rule not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- Settings (template + automation flag) ----
async function getSetting(pool: sql.ConnectionPool, key: string): Promise<string | null> {
  const r = await pool.request().input("k", sql.NVarChar, key).query("SELECT settingValue FROM dbo.Settings WHERE settingKey=@k");
  return r.recordset[0]?.settingValue ?? null;
}
async function setSetting(pool: sql.ConnectionPool, key: string, value: string) {
  await pool.request().input("k", sql.NVarChar, key).input("v", sql.NVarChar, value).query(`
    MERGE dbo.Settings AS t USING (SELECT @k AS k) AS s ON t.settingKey = s.k
    WHEN MATCHED THEN UPDATE SET settingValue=@v, updatedAt=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (settingKey, settingValue) VALUES (@k, @v);`);
}

router.get("/settings", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const template = (await getSetting(pool, "reminder.template")) ?? DEFAULT_TEMPLATE;
    const automationActive = (await getSetting(pool, "reminder.automationActive")) ?? "true";
    res.json({ template, automationActive: automationActive === "true" });
  } catch (e) { next(e); }
});

router.put("/settings", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (b.template !== undefined) await setSetting(pool, "reminder.template", String(b.template));
    if (b.automationActive !== undefined) await setSetting(pool, "reminder.automationActive", b.automationActive ? "true" : "false");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Live queue preview (computed from active rules + unpaid vouchers) ----
// Note: no messages are actually sent yet — WhatsApp/SMS integration is a later phase.
router.get("/queue", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const rulesR = await pool.request().query("SELECT * FROM dbo.ReminderRules WHERE active = 1");
    const rules = rulesR.recordset;
    const vouchersR = await pool.request().query(`
      SELECT v.id, v.voucherNo, v.amount, v.paidAmount, v.dueDate, s.fullName AS studentName
      FROM dbo.Vouchers v JOIN dbo.Students s ON s.id = v.studentId
      WHERE v.status <> 'paid' AND v.dueDate IS NOT NULL
    `);
    const queue: Array<Record<string, unknown>> = [];
    for (const v of vouchersR.recordset) {
      const due = new Date(v.dueDate);
      for (const r of rules) {
        const d = new Date(due);
        const sign = r.offsetType === "before" ? -1 : r.offsetType === "after" ? 1 : 0;
        d.setDate(d.getDate() + sign * r.offsetDays);
        queue.push({
          studentName: v.studentName,
          voucherNo: v.voucherNo,
          amount: v.amount - v.paidAmount,
          dueDate: v.dueDate,
          scheduledFor: d.toISOString().slice(0, 10),
          rule: r.offsetType === "on" ? "On due date" : `${r.offsetDays} day(s) ${r.offsetType}`,
          channels: r.channels || "",
        });
      }
    }
    queue.sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
    res.json({ pendingIntegration: true, queue });
  } catch (e) { next(e); }
});

export default router;
