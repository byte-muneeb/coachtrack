import { Router } from "express";
import { getPool, sql } from "../db";

const router = Router();

// GET /api/dashboard?month=YYYY-MM — live KPIs aggregated from real data.
// `month` scopes the "this month" metrics (revenue + new registrations) to
// any chosen month; omitting it defaults to the current calendar month.
router.get("/dashboard", async (req, res, next) => {
  try {
    const pool = await getPool();

    // Resolve the selected month to a valid 'yyyy-MM'; fall back to current.
    const raw = String(req.query.month || "");
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(raw);

    const kpi = await pool.request()
      .input("useSel", sql.Bit, monthMatch ? 1 : 0)
      .input("selYear", sql.Int, monthMatch ? Number(monthMatch[1]) : 2000)
      .input("selMonth", sql.Int, monthMatch ? Number(monthMatch[2]) : 1)
      .query(`
      DECLARE @start DATE = IIF(@useSel = 1,
        DATEFROMPARTS(@selYear, @selMonth, 1),
        DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1));
      DECLARE @end DATE = DATEADD(MONTH, 1, @start);
      SELECT
        (SELECT ISNULL(SUM(amount),0) FROM dbo.Payments) AS totalCollected,
        (SELECT ISNULL(SUM(amount),0) FROM dbo.Payments
           WHERE paidAt >= @start AND paidAt < @end) AS revenueMTD,
        (SELECT ISNULL(SUM(amount - paidAmount),0) FROM dbo.Vouchers) AS totalOutstanding,
        (SELECT COUNT(*) FROM dbo.Students) AS studentsCount,
        (SELECT COUNT(*) FROM (SELECT studentId FROM dbo.Vouchers GROUP BY studentId HAVING SUM(amount - paidAmount) > 0) x) AS outstandingStudentsCount,
        (SELECT COUNT(*) FROM dbo.Students
           WHERE createdAt >= @start AND createdAt < @end) AS newRegistrationsMTD,
        CONVERT(CHAR(7), @start, 126) AS selectedMonth
    `);
    const k = kpi.recordset[0];
    const denom = (k.totalCollected || 0) + (k.totalOutstanding || 0);
    const collectionEfficiency = denom > 0 ? Math.round((k.totalCollected / denom) * 1000) / 10 : 0;

    // Last 6 months of collections ending at the selected month.
    const trend = await pool.request()
      .input("sel", sql.NVarChar, k.selectedMonth)
      .query(`
      DECLARE @anchor DATE = DATEFROMPARTS(
        CAST(LEFT(@sel,4) AS INT), CAST(RIGHT(@sel,2) AS INT), 1);
      SELECT FORMAT(paidAt, 'yyyy-MM') AS ym, SUM(amount) AS collected
      FROM dbo.Payments
      WHERE paidAt >= DATEADD(MONTH, -5, @anchor) AND paidAt < DATEADD(MONTH, 1, @anchor)
      GROUP BY FORMAT(paidAt, 'yyyy-MM') ORDER BY ym
    `);

    const recent = await pool.request().query(`
      SELECT TOP 6 p.amount, p.method, p.paidAt, s.fullName AS studentName, v.voucherNo
      FROM dbo.Payments p
      JOIN dbo.Vouchers v ON v.id = p.voucherId
      JOIN dbo.Students s ON s.id = v.studentId
      ORDER BY p.paidAt DESC
    `);

    // Students who currently owe fees (drives the Outstanding Students panel).
    const outstanding = await pool.request().query(`
      SELECT TOP 8 s.id, s.fullName, s.registryId, s.course, bal.outstanding,
        (SELECT COUNT(*) FROM dbo.Vouchers v WHERE v.studentId = s.id AND v.status <> 'paid'
           AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE)) AS overdueCount
      FROM dbo.Students s
      JOIN (SELECT studentId, SUM(amount - paidAmount) AS outstanding FROM dbo.Vouchers
              GROUP BY studentId HAVING SUM(amount - paidAmount) > 0) bal ON bal.studentId = s.id
      ORDER BY bal.outstanding DESC
    `);

    // Distinct months that have payments (for the month picker), newest first.
    const months = await pool.request().query(`
      SELECT DISTINCT FORMAT(paidAt, 'yyyy-MM') AS ym FROM dbo.Payments ORDER BY ym DESC
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
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : null;
    const course = String(req.query.course || "").trim();
    const status = String(req.query.status || "").trim(); // voucher status filter for defaulters

    // Payment date-range predicate (reused across queries).
    const payDate: string[] = [];
    if (from) payDate.push("p.paidAt >= @from");
    if (to) payDate.push("p.paidAt < DATEADD(DAY,1,@to)");
    const payDateClause = payDate.length ? "AND " + payDate.join(" AND ") : "";
    // A student "belongs to" the course filter if they have an enrollment in it.
    const courseExists = course
      ? `AND EXISTS (SELECT 1 FROM dbo.Enrollments e JOIN dbo.Courses c ON c.id=e.courseId WHERE e.studentId=s.id AND c.name=@course)`
      : "";

    // Adds the shared filter parameters onto a request.
    function bind(r: sql.Request): sql.Request {
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
           WHERE 1=1 ${payDateClause} ${courseExists}) AS totalCollected,
        (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v
           JOIN dbo.Students s ON s.id = v.studentId WHERE 1=1 ${courseExists}) AS totalOutstanding,
        (SELECT COUNT(*) FROM dbo.Students) AS totalStudents,
        (SELECT COUNT(*) FROM dbo.Vouchers WHERE status <> 'paid' AND dueDate < CAST(SYSUTCDATETIME() AS DATE)) AS overdueVouchers
    `);
    const t = totals.recordset[0];
    const denom = (t.totalCollected || 0) + (t.totalOutstanding || 0);
    const collectionEfficiency = denom > 0 ? Math.round((t.totalCollected / denom) * 1000) / 10 : 0;

    // Collections grouped by month within the range.
    const monthly = await bind(pool.request()).query(`
      SELECT FORMAT(p.paidAt,'yyyy-MM') AS ym, SUM(p.amount) AS collected
      FROM dbo.Payments p
      JOIN dbo.Vouchers v ON v.id=p.voucherId
      JOIN dbo.Students s ON s.id=v.studentId
      WHERE 1=1 ${payDateClause} ${courseExists}
      GROUP BY FORMAT(p.paidAt,'yyyy-MM') ORDER BY ym
    `);

    // Expected monthly billing by course (from active enrollments).
    const billingByCourse = await bind(pool.request()).query(`
      SELECT ISNULL(c.name,'Unassigned') AS course, SUM(e.monthlyFee) AS expected,
             COUNT(DISTINCT e.studentId) AS students
      FROM dbo.Enrollments e
      LEFT JOIN dbo.Courses c ON c.id = e.courseId
      WHERE e.status='active' ${course ? "AND c.name=@course" : ""}
      GROUP BY c.name ORDER BY expected DESC
    `);

    // Defaulters (optionally scoped to course).
    const defaulters = await bind(pool.request()).query(`
      SELECT TOP 50 s.id, s.fullName, s.registryId, s.course,
        (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v WHERE v.studentId = s.id) AS outstanding,
        (SELECT COUNT(*) FROM dbo.Vouchers v WHERE v.studentId = s.id AND v.status <> 'paid'
           AND v.dueDate < CAST(SYSUTCDATETIME() AS DATE)) AS overdueCount
      FROM dbo.Students s
      WHERE (SELECT ISNULL(SUM(v.amount - v.paidAmount),0) FROM dbo.Vouchers v WHERE v.studentId = s.id) > 0 ${courseExists}
      ORDER BY outstanding DESC
    `);

    const courseList = await pool.request().query("SELECT name FROM dbo.Courses ORDER BY name");

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
