/**
 * Clean-slate seed. Wipes all operational tables and inserts a realistic
 * sample dataset so every flow can be exercised end-to-end.
 * Run: npx tsx src/seed.ts
 */
import { getPool, sql, ensureSchema } from "./db";
import { createVoucher } from "./routes/vouchers";

async function main() {
  await ensureSchema();
  const pool = await getPool();

  // 1) Clear everything (FK-safe order). Settings kept but profile reset below.
  const wipe = [
    "Payments", "VoucherItems", "Vouchers", "Transfers", "Enrollments",
    "Students", "Batches", "Courses", "FeeComponents", "Expenses",
    "Inquiries", "ReminderRules", "Branches", "AuditLog",
  ];
  for (const t of wipe) {
    await pool.request().query(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DELETE FROM dbo.${t};`);
  }
  // Reset identities so ids start clean.
  for (const t of wipe) {
    await pool.request().query(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DBCC CHECKIDENT('dbo.${t}', RESEED, 0);`);
  }
  console.log("Cleared operational tables.");

  // 2) Institute profile
  const profile = {
    name: "Ali Academy", tagline: "MDCAT & ECAT Specialists", phone: "042-35700123",
    email: "info@aliacademy.pk", address: "12 Model Town", city: "Lahore",
    currency: "PKR", academicYear: "2026-27", voucherPrefix: "CT",
    voucherFooter: "Please pay before the due date to avoid a late fee. Fee once paid is non-refundable.",
    logoText: "AA",
  };
  await pool.request()
    .input("k", sql.NVarChar, "institute.profile")
    .input("v", sql.NVarChar, JSON.stringify(profile))
    .query(`MERGE dbo.Settings AS t USING (SELECT @k AS k) s ON t.settingKey=s.k
            WHEN MATCHED THEN UPDATE SET settingValue=@v, updatedAt=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (settingKey,settingValue) VALUES (@k,@v);`);

  // 3) Courses
  const courses = [
    { name: "MDCAT Prep", code: "MD-01", level: "Advanced", durationMonths: 6, admissionFee: 5000, monthlyFee: 8000, examFee: 3000 },
    { name: "ECAT Prep", code: "EC-01", level: "Advanced", durationMonths: 4, admissionFee: 4000, monthlyFee: 7000, examFee: 2500 },
    { name: "O-Level English", code: "OL-EN", level: "Intermediate", durationMonths: 9, admissionFee: 3000, monthlyFee: 5000, examFee: 1500 },
  ];
  const courseId: Record<string, number> = {};
  for (const c of courses) {
    const r = await pool.request()
      .input("name", sql.NVarChar, c.name).input("code", sql.NVarChar, c.code)
      .input("level", sql.NVarChar, c.level).input("dur", sql.Int, c.durationMonths)
      .input("adm", sql.Float, c.admissionFee).input("mon", sql.Float, c.monthlyFee).input("exam", sql.Float, c.examFee)
      .query(`INSERT INTO dbo.Courses (name,code,level,durationMonths,admissionFee,monthlyFee,examFee,status)
              OUTPUT INSERTED.id VALUES (@name,@code,@level,@dur,@adm,@mon,@exam,'active')`);
    courseId[c.name] = r.recordset[0].id;
  }
  console.log("Courses:", courseId);

  // 4) Batches (per-batch monthly fee — same course, different batch fees)
  const batches = [
    { course: "MDCAT Prep", name: "Morning A", timeSlot: "08:00 AM", teacher: "Dr. Kamran", monthlyFee: 8000 },
    { course: "MDCAT Prep", name: "Evening B", timeSlot: "05:00 PM", teacher: "Dr. Sana", monthlyFee: 8500 },
    { course: "ECAT Prep", name: "Morning A", timeSlot: "09:00 AM", teacher: "Sir Adeel", monthlyFee: 7000 },
    { course: "O-Level English", name: "Weekend", timeSlot: "Sat-Sun 11:00 AM", teacher: "Ms. Hina", monthlyFee: 5000 },
  ];
  const batchId: Record<string, { id: number; fee: number; courseId: number }> = {};
  for (const b of batches) {
    const r = await pool.request()
      .input("cid", sql.Int, courseId[b.course]).input("name", sql.NVarChar, b.name)
      .input("slot", sql.NVarChar, b.timeSlot).input("teacher", sql.NVarChar, b.teacher)
      .input("start", sql.Date, new Date("2026-07-01")).input("fee", sql.Float, b.monthlyFee)
      .query(`INSERT INTO dbo.Batches (courseId,name,timeSlot,teacher,startDate,monthlyFee,status)
              OUTPUT INSERTED.id VALUES (@cid,@name,@slot,@teacher,@start,@fee,'active')`);
    batchId[`${b.course}|${b.name}`] = { id: r.recordset[0].id, fee: b.monthlyFee, courseId: courseId[b.course] };
  }
  console.log("Batches seeded:", Object.keys(batchId).length);

  // 4b) Branches (two, so the branch filter differentiates)
  const branchDefs = [
    { name: "Model Town Campus", city: "Lahore", addr: "12 Model Town", mgr: "Mr. Farhan" },
    { name: "Gulberg Campus", city: "Lahore", addr: "5 Main Blvd, Gulberg", mgr: "Ms. Nadia" },
  ];
  const branchIds: number[] = [];
  for (const b of branchDefs) {
    const r = await pool.request()
      .input("n", sql.NVarChar, b.name).input("c", sql.NVarChar, b.city)
      .input("a", sql.NVarChar, b.addr).input("m", sql.NVarChar, b.mgr)
      .query("INSERT INTO dbo.Branches (name,city,address,phone,manager,status) OUTPUT INSERTED.id VALUES (@n,@c,@a,'042-35700123',@m,'active')");
    branchIds.push(r.recordset[0].id);
  }

  // 5) Students + enrollments (some in multiple batches)
  const students = [
    { name: "Ahmed Raza", phone: "0300-1112223", guardian: "Raza Khan", rel: "Father", status: "active", branch: 0, enroll: ["MDCAT Prep|Morning A"] },
    { name: "Zara Sheikh", phone: "0321-4455667", guardian: "Sheikh Imran", rel: "Father", status: "suspended", branch: 0, enroll: ["MDCAT Prep|Evening B"] },
    { name: "Bilal Aslam", phone: "0333-9988776", guardian: "Aslam Pervaiz", rel: "Father", status: "graduated", branch: 0, enroll: ["ECAT Prep|Morning A"] },
    { name: "Hassan Ali", phone: "0300-5556666", guardian: "Ali Haider", rel: "Father", status: "active", branch: 1, enroll: ["MDCAT Prep|Morning A", "O-Level English|Weekend"] },
    { name: "Ayesha Malik", phone: "0345-1237890", guardian: "Malik Tanveer", rel: "Father", status: "pending", branch: 1, enroll: ["ECAT Prep|Morning A", "O-Level English|Weekend"] },
    { name: "Usman Tariq", phone: "0301-7654321", guardian: "Tariq Mehmood", rel: "Father", status: "active", branch: 1, enroll: ["O-Level English|Weekend"] },
  ];
  let n = 0;
  for (const s of students) {
    n += 1;
    const registryId = `CT-2026-${String(n).padStart(4, "0")}`;
    const sr = await pool.request()
      .input("rid", sql.NVarChar, registryId).input("name", sql.NVarChar, s.name)
      .input("phone", sql.NVarChar, s.phone).input("gn", sql.NVarChar, s.guardian).input("gr", sql.NVarChar, s.rel)
      .input("course", sql.NVarChar, s.enroll[0].split("|")[0]).input("batch", sql.NVarChar, s.enroll[0].split("|")[1])
      .input("status", sql.NVarChar, s.status).input("branchId", sql.Int, branchIds[s.branch])
      .query(`INSERT INTO dbo.Students (registryId,fullName,phone,guardianName,guardianRelation,course,batch,status,commencementDate,branchId)
              OUTPUT INSERTED.id VALUES (@rid,@name,@phone,@gn,@gr,@course,@batch,@status,'2026-07-01',@branchId)`);
    const sid = sr.recordset[0].id;
    const chargedCourses = new Set<string>();
    for (const key of s.enroll) {
      const b = batchId[key];
      await pool.request()
        .input("sid", sql.Int, sid).input("bid", sql.Int, b.id).input("cid", sql.Int, b.courseId).input("fee", sql.Float, b.fee)
        .query(`INSERT INTO dbo.Enrollments (studentId,batchId,courseId,monthlyFee,status,startDate)
                VALUES (@sid,@bid,@cid,@fee,'active','2026-07-01')`);
      // charge admission once per course
      const cname = key.split("|")[0];
      if (!chargedCourses.has(cname)) {
        chargedCourses.add(cname);
        const adm = courses.find((c) => c.name === cname)!.admissionFee;
        if (adm > 0) {
          await createVoucher(pool, {
            studentId: sid, amount: adm, description: `Admission Fee — ${cname}`,
            generateDate: new Date("2026-07-01"), dueDate: new Date("2026-07-10"),
            items: [{ batchId: null, label: `${cname} — Admission Fee`, amount: adm }],
          });
        }
      }
    }
  }
  console.log("Students + enrollments seeded:", students.length);

  // 6) Fee components (used for custom / ad-hoc vouchers)
  // Ad-hoc fee components for custom vouchers — NOT admission/exam (those live
  // on the course and are charged automatically / via "Charge Exam Fee").
  const fees = [
    { name: "Prospectus & ID Card", category: "Service", frequency: "One-time", amount: 800 },
    { name: "Late Fee Fine", category: "Other", frequency: "One-time", amount: 500 },
    { name: "Mock Test Series", category: "Exam", frequency: "One-time", amount: 2500 },
  ];
  for (const f of fees) {
    await pool.request()
      .input("name", sql.NVarChar, f.name).input("cat", sql.NVarChar, f.category)
      .input("freq", sql.NVarChar, f.frequency).input("amt", sql.Float, f.amount)
      .query(`INSERT INTO dbo.FeeComponents (name,category,frequency,amount,status) VALUES (@name,@cat,@freq,@amt,'active')`);
  }

  // 8) A couple of inquiries (pipeline)
  const inqs = [
    { name: "Sana Javed", phone: "0300-2223344", course: "MDCAT Prep", source: "Facebook", stage: "new" },
    { name: "Hamza Nadeem", phone: "0321-9990001", course: "ECAT Prep", source: "Referral", stage: "trial" },
  ];
  for (const i of inqs) {
    await pool.request()
      .input("name", sql.NVarChar, i.name).input("phone", sql.NVarChar, i.phone)
      .input("course", sql.NVarChar, i.course).input("source", sql.NVarChar, i.source).input("stage", sql.NVarChar, i.stage)
      .query(`INSERT INTO dbo.Inquiries (name,phone,interestedCourse,source,stage) VALUES (@name,@phone,@course,@source,@stage)`);
  }

  // 9) One expense (so profit reporting has data)
  await pool.request()
    .input("date", sql.Date, new Date("2026-07-05")).input("cat", sql.NVarChar, "Rent")
    .input("desc", sql.NVarChar, "Campus rent - July").input("amt", sql.Float, 120000).input("via", sql.NVarChar, "Bank Transfer (IBFT)")
    .query(`INSERT INTO dbo.Expenses (date,category,description,amount,paidVia) VALUES (@date,@cat,@desc,@amt,@via)`);

  // Tag courses to the primary branch (students were assigned per-record above).
  await pool.request().input("b", sql.Int, branchIds[0]).query("UPDATE dbo.Courses SET branchId=@b");

  // Mark one student (Usman) fully paid so the "Cleared" fee-status filter has data.
  const u = await pool.request().input("r", sql.NVarChar, "CT-2026-0006").query("SELECT id FROM dbo.Students WHERE registryId=@r");
  if (u.recordset[0]) {
    const sid = u.recordset[0].id;
    const vs = await pool.request().input("sid", sql.Int, sid).query("SELECT id, amount FROM dbo.Vouchers WHERE studentId=@sid AND status<>'paid'");
    for (const v of vs.recordset) {
      await pool.request().input("vid", sql.Int, v.id).input("amt", sql.Float, v.amount)
        .query("INSERT INTO dbo.Payments (voucherId,amount,method,receivedBy) VALUES (@vid,@amt,'Cash','Mr. Bilal (Accounts)')");
      await pool.request().input("vid", sql.Int, v.id).query("UPDATE dbo.Vouchers SET paidAmount=amount, status='paid' WHERE id=@vid");
    }
  }

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
