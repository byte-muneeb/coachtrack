import { Router } from "express";
import { getPool, sql, type SqlPool } from "../db";
import { requireRole, type AuthedRequest } from "../auth";
import { scope } from "../tenant";

const router = Router();

// Reminders configuration is entity-admin only (per the permission matrix).
router.use(requireRole("entity_admin"));

const DEFAULT_TEMPLATE =
  "Dear Parent, this is a reminder that {StudentName}'s fee of Rs {Amount} is due on {DueDate}. Please pay on time to avoid interruption. - CoachTrack";

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function intOr0(v: unknown): number { const n = parseInt(String(v), 10); return isNaN(n) ? 0 : n; }

// ---- Rules (entity-level) ----
router.get("/rules", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const r = await s.apply(pool.request())
      .query(`SELECT * FROM dbo.ReminderRules WHERE 1=1 ${s.entityClause} ORDER BY offsetType, offsetDays`);
    res.json(r.recordset.map((x) => ({ ...x, active: !!x.active })));
  } catch (e) { next(e); }
});

router.post("/rules", async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    const offsetType = ["before", "on", "after"].includes(b.offsetType) ? b.offsetType : "before";
    const r = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("offsetType", sql.NVarChar, offsetType)
      .input("offsetDays", sql.Int, offsetType === "on" ? 0 : intOr0(b.offsetDays))
      .input("channels", sql.NVarChar, str(b.channels))
      .input("active", sql.Bit, b.active === false ? 0 : 1)
      .query(`INSERT INTO dbo.ReminderRules (entityId, offsetType, offsetDays, channels, active)
              OUTPUT INSERTED.* VALUES (@ent,@offsetType,@offsetDays,@channels,@active)`);
    const row = r.recordset[0];
    res.status(201).json({ ...row, active: !!row.active });
  } catch (e) { next(e); }
});

router.put("/rules/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.ReminderRules WHERE id=@id ${s.entityClause}`);
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Rule not found" });
    const b = req.body || {};
    const offsetType = b.offsetType !== undefined && ["before", "on", "after"].includes(b.offsetType) ? b.offsetType : cur.offsetType;
    const r = await s.apply(pool.request())
      .input("id", sql.Int, id)
      .input("offsetType", sql.NVarChar, offsetType)
      .input("offsetDays", sql.Int, b.offsetDays !== undefined ? (offsetType === "on" ? 0 : intOr0(b.offsetDays)) : cur.offsetDays)
      .input("channels", sql.NVarChar, b.channels !== undefined ? str(b.channels) : cur.channels)
      .input("active", sql.Bit, b.active !== undefined ? (b.active ? 1 : 0) : cur.active)
      .query(`UPDATE dbo.ReminderRules SET offsetType=@offsetType, offsetDays=@offsetDays, channels=@channels, active=@active, updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id ${s.entityClause}`);
    const row = r.recordset[0];
    res.json({ ...row, active: !!row.active });
  } catch (e) { next(e); }
});

router.delete("/rules/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.ReminderRules WHERE id=@id ${s.entityClause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Rule not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- Settings (template + automation flag), per entity ----
async function getSetting(pool: SqlPool, entityId: number | null, key: string): Promise<string | null> {
  const r = await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, key)
    .query("SELECT settingValue FROM dbo.Settings WHERE entityId=@e AND settingKey=@k");
  return r.recordset[0]?.settingValue ?? null;
}
async function setSetting(pool: SqlPool, entityId: number | null, key: string, value: string) {
  await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, key).input("v", sql.NVarChar, value).query(`
    INSERT INTO Settings (entityId, settingKey, settingValue, updatedAt) VALUES (@e, @k, @v, now())
    ON CONFLICT (entityId, settingKey) DO UPDATE SET settingValue=EXCLUDED.settingValue, updatedAt=now();`);
}

router.get("/settings", async (req, res, next) => {
  try {
    const pool = await getPool();
    const ent = (req as AuthedRequest).ctx!.entityId;
    const template = (await getSetting(pool, ent, "reminder.template")) ?? DEFAULT_TEMPLATE;
    const automationActive = (await getSetting(pool, ent, "reminder.automationActive")) ?? "true";
    res.json({ template, automationActive: automationActive === "true" });
  } catch (e) { next(e); }
});

router.put("/settings", async (req, res, next) => {
  try {
    const pool = await getPool();
    const ent = (req as AuthedRequest).ctx!.entityId;
    const b = req.body || {};
    if (b.template !== undefined) await setSetting(pool, ent, "reminder.template", String(b.template));
    if (b.automationActive !== undefined) await setSetting(pool, ent, "reminder.automationActive", b.automationActive ? "true" : "false");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Live queue preview (computed from active rules + unpaid vouchers) ----
// Note: no messages are actually sent yet — WhatsApp/SMS integration is a later phase.
router.get("/queue", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx, { entityCol: "v.entityId", branchCol: "v.branchId" });
    const es = scope((req as AuthedRequest).ctx);
    const rulesR = await es.apply(pool.request()).query(`SELECT * FROM dbo.ReminderRules WHERE active = 1 ${es.entityClause}`);
    const rules = rulesR.recordset;
    const vouchersR = await s.apply(pool.request()).query(`
      SELECT v.id, v.voucherNo, v.amount, v.paidAmount, v.dueDate, s.fullName AS studentName
      FROM dbo.Vouchers v JOIN dbo.Students s ON s.id = v.studentId
      WHERE v.status <> 'paid' AND v.dueDate IS NOT NULL ${s.clause}
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
