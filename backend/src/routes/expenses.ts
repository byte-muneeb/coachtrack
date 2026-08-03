import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

function num(v: unknown, fallback = 0): number { const n = Number(v); return isNaN(n) ? fallback : n; }
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function toDate(v: unknown): Date { const d = new Date(String(v || "")); return isNaN(d.getTime()) ? new Date() : d; }

router.get("/", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT * FROM dbo.Expenses ORDER BY date DESC, id DESC");
    res.json(r.recordset);
  } catch (e) { next(e); }
});

// Income (from recorded payments) vs expenses + net profit + breakdown by category
router.get("/summary", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const inc = await pool.request().query("SELECT ISNULL(SUM(amount),0) AS totalIncome FROM dbo.Payments");
    const exp = await pool.request().query("SELECT ISNULL(SUM(amount),0) AS totalExpenses FROM dbo.Expenses");
    const cat = await pool.request().query("SELECT ISNULL(category,'Uncategorized') AS category, SUM(amount) AS total FROM dbo.Expenses GROUP BY category ORDER BY total DESC");
    const totalIncome = inc.recordset[0].totalIncome || 0;
    const totalExpenses = exp.recordset[0].totalExpenses || 0;
    res.json({ totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, byCategory: cat.recordset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const b = req.body || {};
    if (num(b.amount) <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    const r = await pool.request()
      .input("date", sql.Date, toDate(b.date))
      .input("category", sql.NVarChar, str(b.category))
      .input("description", sql.NVarChar, str(b.description))
      .input("amount", sql.Float, num(b.amount))
      .input("paidVia", sql.NVarChar, str(b.paidVia))
      .query(`INSERT INTO dbo.Expenses (date, category, description, amount, paidVia)
              OUTPUT INSERTED.* VALUES (@date,@category,@description,@amount,@paidVia)`);
    res.status(201).json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ex = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.Expenses WHERE id=@id");
    const cur = ex.recordset[0];
    if (!cur) return res.status(404).json({ error: "Expense not found" });
    const b = req.body || {};
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("date", sql.Date, b.date !== undefined ? toDate(b.date) : cur.date)
      .input("category", sql.NVarChar, b.category !== undefined ? str(b.category) : cur.category)
      .input("description", sql.NVarChar, b.description !== undefined ? str(b.description) : cur.description)
      .input("amount", sql.Float, b.amount !== undefined ? num(b.amount) : cur.amount)
      .input("paidVia", sql.NVarChar, b.paidVia !== undefined ? str(b.paidVia) : cur.paidVia)
      .query(`UPDATE dbo.Expenses SET date=@date,category=@category,description=@description,amount=@amount,paidVia=@paidVia,updatedAt=SYSUTCDATETIME()
              OUTPUT INSERTED.* WHERE id=@id`);
    res.json(r.recordset[0]);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Expenses WHERE id=@id");
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Expense not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
