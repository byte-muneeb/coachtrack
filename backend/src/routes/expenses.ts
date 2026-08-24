import { Router } from "express";
import { getPool, sql } from "../db";
import { type AuthedRequest } from "../auth";
import { scope, resolveWriteBranch } from "../tenant";

const router = Router();

function num(v: unknown, fallback = 0): number { const n = Number(v); return isNaN(n) ? fallback : n; }
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function toDate(v: unknown): Date { const d = new Date(String(v || "")); return isNaN(d.getTime()) ? new Date() : d; }

router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const r = await s.apply(pool.request())
      .query(`SELECT * FROM dbo.Expenses WHERE 1=1 ${s.clause} ORDER BY date DESC, id DESC`);
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// Income (from recorded payments) vs expenses + net profit + breakdown by category
router.get("/summary", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const inc = await s.apply(pool.request()).query(`SELECT ISNULL(SUM(amount),0) AS totalIncome FROM dbo.Payments WHERE 1=1 ${s.clause}`);
    const exp = await s.apply(pool.request()).query(`SELECT ISNULL(SUM(amount),0) AS totalExpenses FROM dbo.Expenses WHERE 1=1 ${s.clause}`);
    const cat = await s.apply(pool.request()).query(`SELECT ISNULL(category,'Uncategorized') AS category, SUM(amount) AS total FROM dbo.Expenses WHERE 1=1 ${s.clause} GROUP BY category ORDER BY total DESC`);
    const totalIncome = inc.recordset[0].totalIncome || 0;
    const totalExpenses = exp.recordset[0].totalExpenses || 0;
    res.json({ totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, byCategory: cat.recordset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const ctx = (req as AuthedRequest).ctx!;
    const b = req.body || {};
    if (num(b.amount) <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    const branchId = resolveWriteBranch(ctx, b.branchId != null ? Number(b.branchId) : null);
    if (branchId == null) return res.status(400).json({ error: "A valid branch is required" });
    const r = await pool.request()
      .input("ent", sql.Int, ctx.entityId)
      .input("branch", sql.Int, branchId)
      .input("date", sql.Date, toDate(b.date))
      .input("category", sql.NVarChar, str(b.category))
      .input("description", sql.NVarChar, str(b.description))
      .input("amount", sql.Float, num(b.amount))
      .input("paidVia", sql.NVarChar, str(b.paidVia))
      .query(`INSERT INTO dbo.Expenses (entityId, branchId, date, category, description, amount, paidVia)
              OUTPUT INSERTED.* VALUES (@ent,@branch,@date,@category,@description,@amount,@paidVia)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`SELECT * FROM dbo.Expenses WHERE id=@id ${s.clause}`);
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Expense not found" });
    const b = req.body || {};
    const r = await s.apply(pool.request())
      .input("id", sql.Int, id)
      .input("date", sql.Date, b.date !== undefined ? toDate(b.date) : cur.date)
      .input("category", sql.NVarChar, b.category !== undefined ? str(b.category) : cur.category)
      .input("description", sql.NVarChar, b.description !== undefined ? str(b.description) : cur.description)
      .input("amount", sql.Float, b.amount !== undefined ? num(b.amount) : cur.amount)
      .input("paidVia", sql.NVarChar, b.paidVia !== undefined ? str(b.paidVia) : cur.paidVia)
      .query(`UPDATE dbo.Expenses SET date=@date,category=@category,description=@description,amount=@amount,paidVia=@paidVia,updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id ${s.clause}`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = scope((req as AuthedRequest).ctx);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await s.apply(pool.request()).input("id", sql.Int, id)
      .query(`DELETE FROM dbo.Expenses WHERE id=@id ${s.clause}`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Expense not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
