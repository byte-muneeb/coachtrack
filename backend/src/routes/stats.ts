import { Router } from "express";
import { getPool, sql, type SqlRequest } from "../db";
import { type AuthedRequest } from "../auth";

const router = Router();

// Builds the entity (+ branch, for branch-scoped users) filter for a table alias,
// plus a binder that attaches the @ent/@brs params to a request. Every aggregate
// subquery in this file is filtered through `cond(alias)`.
function scoping(req: AuthedRequest) {
  const ctx = req.ctx!;
  const restrictBranch = !ctx.allBranches;
  const brs = ctx.branchIds;
  const cond = (alias: string): string => {
    let c = ` AND ${alias}.entityId = @ent`;
    if (restrictBranch) c += brs.length ? ` AND ${alias}.branchId = ANY(@brs)` : " AND 1=0";
    return c;
  };
  const bindScope = (r: SqlRequest): SqlRequest => {
    r.input("ent", sql.Int, ctx.entityId ?? -1);
    if (restrictBranch && brs.length) r.input("brs", sql.Int, brs);
    return r;
  };
  return { cond, bindScope };
}

// GET /api/dashboard?month=YYYY-MM — live KPIs aggregated from real data.
router.get("/dashboard", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { cond, bindScope } = scoping(req as AuthedRequest);

    const raw = String(req.query.month || "");
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(raw);

    const kpi = await bindScope(pool.request())
      .input("useSel", sql.Bit, monthMatch ? 1 : 0)
      .input("selYear", sql.Int, monthMatch ? Number(monthMatch[1]) : 2000)
      .input("selMonth", sql.Int, monthMatch ? Number(monthMatch[2]) : 1)
      .query(`
      WITH span AS (
        SELECT CASE WHEN @useSel = 1 THEN make_date(@selYear, @selMonth, 1)
                    ELSE date_trunc('month', now())::date END AS start
      )
      SELECT
        (SELECT COALESCE(SUM(amount),0) FROM Payments p WHERE 1=1 ${cond("p")}) AS totalCollected,
        (SELECT COALESCE(SUM(amount),0) FROM Payments p
           WHERE p.paidAt >= (SELECT start FROM span)
             AND p.paidAt < (SELECT start FROM span) + INTERVAL '1 month' ${cond("p")}) AS revenueMTD,
        (SELECT COALESCE(SUM(amount - paidAmount),0) FROM Vouchers v WHERE 1=1 ${cond("v")}) AS totalOutstanding,
        (SELECT COUNT(*) FROM Students st WHERE 1=1 ${cond("st")}) AS studentsCount,
        (SELECT COUNT(*) FROM (SELECT studentId FROM Vouchers v WHERE 1=1 ${cond("v")} GROUP BY studentId HAVING SUM(amount - paidAmount) > 0) x) AS outstandingStudentsCount,
        (SELECT COUNT(*) FROM Students st
           WHERE st.createdAt >= (SELECT start FROM span)
             AND st.createdAt < (SELECT start FROM span) + INTERVAL '1 month' ${cond("st")}) AS newRegistrationsMTD,
        (SELECT to_char(start,'YYYY-MM') FROM span) AS selectedMonth
    `);
    const k = kpi.recordset[0];
    const denom = (k.totalCollected || 0) + (k.totalOutstanding || 0);
    const collectionEfficiency = denom > 0 ? Math.round((k.totalCollected / denom) * 1000) / 10 : 0;

    // Last 6 months of collections ending at the selected month.
    const trend = await bindScope(pool.request())
      .input("sel", sql.NVarChar, k.selectedMonth)
      .query(`
      WITH anchor AS (
        SELECT make_date(CAST(LEFT(@sel,4) AS INT), CAST(RIGHT(@sel,2) AS INT), 1) AS d
      )
      SELECT to_char(p.paidAt, 'YYYY-MM') AS ym, SUM(p.amount) AS collected
      FROM Payments p, anchor
      WHERE p.paidAt >= anchor.d - INTERVAL '5 months' AND p.paidAt < anchor.d + INTERVAL '1 month' ${cond("p")}
      GROUP BY to_char(p.paidAt, 'YYYY-MM') ORDER BY ym
    `);

    const recent = await bindScope(pool.request()).query(`
      SELECT TOP 6 p.amount, p.method, p.paidAt, s.fullName AS studentName, v.voucherNo
      FROM dbo.Payments p
      JOIN dbo.Vouchers v ON v.id = p.voucherId
      JOIN dbo.Students s ON s.id = v.studentId
      WHERE 1=1 ${cond("p")}
      ORDER BY p.paidAt DESC
    `);

    // Students who currently owe fees (drives the Outstanding Students panel).
    const outstanding = await bindScope(pool.request()).query(`
      SELECT TOP 8 s.id, s.fullName, s.registryId, s.course, bal.outstanding,
        (SELECT COUNT(*) FROM dbo.Vouchers v WHERE v.studentId = s.id AND v.status <> 'paid'
           AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE) ${cond("v")}) AS overdueCount
      FROM dbo.Students s
      JOIN (SELECT studentId, SUM(amount - paidAmount) AS outstanding FROM dbo.Vouchers vv
              WHERE 1=1 ${cond("vv")} GROUP BY studentId HAVING SUM(amount - paidAmount) > 0) bal ON bal.studentId = s.id
      WHERE 1=1 ${cond("s")}
      ORDER BY bal.outstanding DESC
    `);

    // Distinct months that have payments (for the month picker), newest first.
    const months = await bindScope(pool.request()).query(`
      SELECT DISTINCT to_char(p.paidAt, 'YYYY-MM') AS ym FROM Payments p WHERE 1=1 ${cond("p")} ORDER BY ym DESC
    `);
    const availableMonths: string[] = months.recordset.map((m) => m.ym);
    if (!availableMonths.includes(k.selectedMonth)) availableMonths.unshift(k.selectedMonth);

    res.json({
      selectedMonth: k.selectedMonth,
      availableMonths,
      revenueMTD: k.revenueMTD || 0,
      totalCollected: k.totalCollected || 0,
      totalOutstanding: k.totalOutstanding || 0,
      studentsCount: k.studentsCount || 0,
      outstandingStudentsCount: k.outstandingStudentsCount || 0,
      newRegistrationsMTD: k.newRegistrationsMTD || 0,
      collectionEfficiency,
      monthlyTrend: trend.recordset,
      recentPayments: recent.recordset,
      outstandingStudents: outstanding.recordset,
    });
  } catch (e) { next(e); }
});

// GET /api/reports?from=&to=&course=&status= — filterable financial + academic overview
router.get("/reports", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { cond, bindScope } = scoping(req as AuthedRequest);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : null;
    const course = String(req.query.course || "").trim();
    const status = String(req.query.status || "").trim();

    const payDate: string[] = [];
    if (from) payDate.push("p.paidAt >= @from");
    if (to) payDate.push("p.paidAt < @to::date + INTERVAL '1 day'");
    const payDateClause = payDate.length ? "AND " + payDate.join(" AND ") : "";
    const courseExists = course
      ? `AND EXISTS (SELECT 1 FROM dbo.Enrollments e JOIN dbo.Courses c ON c.id=e.courseId WHERE e.studentId=s.id AND c.name=@course)`
      : "";

    // Binds shared filters + tenant scope onto a request.
    function bind(r: SqlRequest): SqlRequest {
      bindScope(r);
      if (from) r.input("from", sql.Date, from);
      if (to) r.input("to", sql.Date, to);
      if (course) r.input("course", sql.NVarChar, course);
      return r;
    }

    const totals = await bind(pool.request()).query(`
      SELECT
        (SELECT ISNULL(SUM(p.amount),0) FROM dbo.Payments p
           JOIN dbo.Vouchers v ON v.id=p.voucherId
           JOIN dbo.Students s ON s.id=v.studentId
           WHERE 1=1 ${cond("p")} ${payDateClause} ${courseExists}) AS totalCollected,
        (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v
           JOIN dbo.Students s ON s.id = v.studentId WHERE 1=1 ${cond("v")} ${courseExists}) AS totalOutstanding,
        (SELECT COUNT(*) FROM dbo.Students s WHERE 1=1 ${cond("s")}) AS totalStudents,
        (SELECT COUNT(*) FROM dbo.Vouchers v WHERE v.status <> 'paid' AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE) ${cond("v")}) AS overdueVouchers
    `);
    const t = totals.recordset[0];
    const denom = (t.totalCollected || 0) + (t.totalOutstanding || 0);
    const collectionEfficiency = denom > 0 ? Math.round((t.totalCollected / denom) * 1000) / 10 : 0;

    const monthly = await bind(pool.request()).query(`
      SELECT to_char(p.paidAt,'YYYY-MM') AS ym, SUM(p.amount) AS collected
      FROM dbo.Payments p
      JOIN dbo.Vouchers v ON v.id=p.voucherId
      JOIN dbo.Students s ON s.id=v.studentId
      WHERE 1=1 ${cond("p")} ${payDateClause} ${courseExists}
      GROUP BY to_char(p.paidAt,'YYYY-MM') ORDER BY ym
    `);

    const billingByCourse = await bind(pool.request()).query(`
      SELECT ISNULL(c.name,'Unassigned') AS course, SUM(e.monthlyFee) AS expected,
             COUNT(DISTINCT e.studentId) AS students
      FROM dbo.Enrollments e
      LEFT JOIN dbo.Courses c ON c.id = e.courseId
      WHERE e.status='active' ${cond("e")} ${course ? "AND c.name=@course" : ""}
      GROUP BY c.name ORDER BY expected DESC
    `);

    const defaulters = await bind(pool.request()).query(`
      SELECT TOP 50 s.id, s.fullName, s.registryId, s.course,
        (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v WHERE v.studentId = s.id ${cond("v")}) AS outstanding,
        (SELECT COUNT(*) FROM dbo.Vouchers v WHERE v.studentId = s.id AND v.status <> 'paid'
           AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE) ${cond("v")}) AS overdueCount
      FROM dbo.Students s
      WHERE (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v WHERE v.studentId = s.id ${cond("v")}) > 0 ${cond("s")} ${courseExists}
      ORDER BY outstanding DESC
    `);

    const courseList = await bindScope(pool.request()).query(`SELECT name FROM dbo.Courses c WHERE 1=1 ${cond("c")} ORDER BY name`);

    res.json({
      filters: { from, to, course: course || null, status: status || null },
      availableCourses: courseList.recordset.map((c) => c.name),
      totalRevenue: t.totalCollected || 0,
      totalOutstanding: t.totalOutstanding || 0,
      totalStudents: t.totalStudents || 0,
      overdueVouchers: t.overdueVouchers || 0,
      collectionEfficiency,
      monthlyCollections: monthly.recordset,
      billingByCourse: billingByCourse.recordset,
      defaulters: defaulters.recordset,
    });
  } catch (e) { next(e); }
});

export default router;
