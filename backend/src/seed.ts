/**
 * Multi-tenant clean-slate seed. Drops all tables, rebuilds the schema, and
 * inserts a super admin + TWO demo entities (each with branches, role-based
 * users, courses, students, enrollments, vouchers, a payment) so tenant
 * isolation can be exercised and demonstrated.
 *
 * Run: npx tsx src/seed.ts
 */
import { getPool, sql, ensureSchema } from "./db";
import { createVoucher } from "./routes/vouchers";
import { hashPassword } from "./auth";

const YEAR = new Date().getFullYear();

async function reset(pool: Awaited<ReturnType<typeof getPool>>) {
  await pool.request().query(`
    DROP TABLE IF EXISTS
      AuditLog, UserBranches, Users, Settings, ReminderRules, Inquiries, Expenses,
      Transfers, Enrollments, Payments, VoucherItems, Vouchers, FeeComponents,
      Batches, Courses, Students, Branches, Entities,
      TestResults, Tests, Attendance, Teachers CASCADE;
  `);
  console.log("Dropped all tables.");
}

interface EntityDef {
  name: string; slug: string;
  branches: string[];               // branch names (first is Main)
  courses: { name: string; code: string; admissionFee: number; monthlyFee: number; examFee: number }[];
  students: { name: string; phone: string; branchIx: number; courseIx: number }[];
}

async function seedEntity(pool: Awaited<ReturnType<typeof getPool>>, def: EntityDef, seq: number) {
  // Entity
  const ent = await pool.request()
    .input("name", sql.NVarChar, def.name).input("slug", sql.NVarChar, def.slug)
    .query(`INSERT INTO Entities (name, slug, status) OUTPUT INSERTED.id VALUES (@name, @slug, 'active')`);
  const entityId = ent.recordset[0].id as number;

  // Branches
  const branchIds: number[] = [];
  for (let i = 0; i < def.branches.length; i++) {
    const br = await pool.request().input("ent", sql.Int, entityId).input("n", sql.NVarChar, def.branches[i])
      .input("p", sql.Int, i === 0 ? 1 : 0)
      .query(`INSERT INTO Branches (entityId, name, isPrimary, status, city) OUTPUT INSERTED.id VALUES (@ent,@n,@p,'active','Lahore')`);
    branchIds.push(br.recordset[0].id);
  }

  // Users: entity_admin (all branches) + one accountant (Main only)
  await pool.request()
    .input("ent", sql.Int, entityId).input("u", sql.NVarChar, `${def.slug}-admin`)
    .input("p", sql.NVarChar, hashPassword("admin123")).input("n", sql.NVarChar, `${def.name} Admin`)
    .query(`INSERT INTO Users (entityId, username, passwordHash, fullName, role, status) VALUES (@ent,@u,@p,@n,'entity_admin','active')`);
  const acc = await pool.request()
    .input("ent", sql.Int, entityId).input("u", sql.NVarChar, `${def.slug}-accountant`)
    .input("p", sql.NVarChar, hashPassword("admin123")).input("n", sql.NVarChar, `${def.name} Accountant`)
    .query(`INSERT INTO Users (entityId, username, passwordHash, fullName, role, status) OUTPUT INSERTED.id VALUES (@ent,@u,@p,@n,'accountant','active')`);
  await pool.request().input("uid", sql.Int, acc.recordset[0].id).input("bid", sql.Int, branchIds[0])
    .query("INSERT INTO UserBranches (userId, branchId) VALUES (@uid,@bid)");

  // Institute profile (per entity)
  const profile = { name: def.name, currency: "PKR", voucherPrefix: "CT", academicYear: `${YEAR}-${YEAR + 1}` };
  await pool.request().input("e", sql.Int, entityId).input("k", sql.NVarChar, "institute.profile").input("v", sql.NVarChar, JSON.stringify(profile))
    .query(`INSERT INTO Settings (entityId, settingKey, settingValue) VALUES (@e,@k,@v)`);

  // Courses (at Main branch) + one batch each
  const courseIds: number[] = [];
  for (const c of def.courses) {
    const cr = await pool.request()
      .input("ent", sql.Int, entityId).input("branch", sql.Int, branchIds[0])
      .input("name", sql.NVarChar, c.name).input("code", sql.NVarChar, c.code)
      .input("adm", sql.Float, c.admissionFee).input("mon", sql.Float, c.monthlyFee).input("exam", sql.Float, c.examFee)
      .query(`INSERT INTO Courses (entityId, branchId, name, code, admissionFee, monthlyFee, examFee, status)
              OUTPUT INSERTED.id VALUES (@ent,@branch,@name,@code,@adm,@mon,@exam,'active')`);
    const cid = cr.recordset[0].id as number;
    courseIds.push(cid);
    await pool.request()
      .input("ent", sql.Int, entityId).input("branch", sql.Int, branchIds[0]).input("cid", sql.Int, cid)
      .input("fee", sql.Float, c.monthlyFee)
      .query(`INSERT INTO Batches (entityId, branchId, courseId, name, timeSlot, teacher, monthlyFee, status)
              VALUES (@ent,@branch,@cid,'Morning A','08:00 AM','Teacher',@fee,'active')`);
  }

  // Fee component + inquiry + expense
  await pool.request().input("ent", sql.Int, entityId).input("branch", sql.Int, branchIds[0])
    .query(`INSERT INTO FeeComponents (entityId, branchId, name, category, frequency, amount, status) VALUES (@ent,@branch,'ID Card','Service','One-time',500,'active')`);
  await pool.request().input("ent", sql.Int, entityId).input("branch", sql.Int, branchIds[0])
    .query(`INSERT INTO Inquiries (entityId, branchId, name, phone, source, stage) VALUES (@ent,@branch,'Prospective Parent','0300-0000000','Facebook','new')`);
  await pool.request().input("ent", sql.Int, entityId).input("branch", sql.Int, branchIds[0])
    .query(`INSERT INTO Expenses (entityId, branchId, date, category, description, amount, paidVia) VALUES (@ent,@branch, now()::date, 'Rent', 'Campus rent', 80000, 'Bank Transfer (IBFT)')`);

  // Students + enrollments (enrollment triggers an admission-fee voucher)
  let n = 0;
  for (const s of def.students) {
    n += 1;
    const branchId = branchIds[Math.min(s.branchIx, branchIds.length - 1)];
    const courseId = courseIds[Math.min(s.courseIx, courseIds.length - 1)];
    const registryId = `CT-${YEAR}-${String(n).padStart(4, "0")}`;
    const sr = await pool.request()
      .input("ent", sql.Int, entityId).input("branch", sql.Int, branchId)
      .input("rid", sql.NVarChar, registryId).input("name", sql.NVarChar, s.name).input("phone", sql.NVarChar, s.phone)
      .input("course", sql.NVarChar, def.courses[s.courseIx].name)
      .input("batch", sql.NVarChar, "Morning A")
      .query(`INSERT INTO Students (entityId, branchId, registryId, fullName, phone, course, batch, status, commencementDate)
              OUTPUT INSERTED.id VALUES (@ent,@branch,@rid,@name,@phone,@course,@batch,'active', now()::date)`);
    const sid = sr.recordset[0].id as number;

    const c = def.courses[s.courseIx];
    // batch for this course
    const bat = await pool.request().input("ent", sql.Int, entityId).input("cid", sql.Int, courseId)
      .query("SELECT id, monthlyFee FROM Batches WHERE entityId=@ent AND courseId=@cid LIMIT 1");
    const batchId = bat.recordset[0].id as number;
    await pool.request()
      .input("ent", sql.Int, entityId).input("branch", sql.Int, branchId)
      .input("sid", sql.Int, sid).input("bid", sql.Int, batchId).input("cid", sql.Int, courseId).input("fee", sql.Float, c.monthlyFee)
      .query(`INSERT INTO Enrollments (entityId, branchId, studentId, batchId, courseId, monthlyFee, status, startDate)
              VALUES (@ent,@branch,@sid,@bid,@cid,@fee,'active', now()::date)`);

    // Admission voucher
    const vid = await createVoucher(pool, {
      entityId, branchId, studentId: sid, amount: c.admissionFee, description: `Admission Fee — ${c.name}`,
      items: [{ batchId: null, label: `${c.name} — Admission Fee`, amount: c.admissionFee }],
    });

    // Record a partial payment for the first student of each entity.
    if (n === 1) {
      const half = Math.round(c.admissionFee / 2);
      await pool.request()
        .input("ent", sql.Int, entityId).input("branch", sql.Int, branchId).input("vid", sql.Int, vid)
        .input("amt", sql.Float, half)
        .query(`INSERT INTO Payments (entityId, branchId, voucherId, amount, method, receivedBy) VALUES (@ent,@branch,@vid,@amt,'Cash','Accountant')`);
      await pool.request().input("vid", sql.Int, vid).input("paid", sql.Float, half)
        .query("UPDATE Vouchers SET paidAmount=@paid, status='partial' WHERE id=@vid");
    }
  }

  console.log(`Seeded entity "${def.name}" (id ${entityId}): ${def.branches.length} branches, ${def.students.length} students.`);
}

async function main() {
  const pool = await getPool();
  await reset(pool);
  await ensureSchema(); // rebuilds schema + seeds the platform super admin
  console.log("Schema rebuilt; super admin = superadmin / admin123");

  const entities: EntityDef[] = [
    {
      name: "Ali Academy", slug: "ali",
      branches: ["Model Town Campus", "Gulberg Campus"],
      courses: [
        { name: "MDCAT Prep", code: "MD-01", admissionFee: 5000, monthlyFee: 8000, examFee: 3000 },
        { name: "ECAT Prep", code: "EC-01", admissionFee: 4000, monthlyFee: 7000, examFee: 2500 },
      ],
      students: [
        { name: "Ahmed Raza", phone: "0300-1112223", branchIx: 0, courseIx: 0 },
        { name: "Zara Sheikh", phone: "0321-4455667", branchIx: 0, courseIx: 1 },
        { name: "Hassan Ali", phone: "0300-5556666", branchIx: 1, courseIx: 0 },
      ],
    },
    {
      name: "Bright Future Institute", slug: "bright",
      branches: ["Main Campus", "DHA Campus"],
      courses: [
        { name: "O-Level Sciences", code: "OL-SCI", admissionFee: 3000, monthlyFee: 6000, examFee: 1500 },
        { name: "A-Level Maths", code: "AL-MATH", admissionFee: 3500, monthlyFee: 6500, examFee: 2000 },
      ],
      students: [
        { name: "Fatima Noor", phone: "0333-1002003", branchIx: 0, courseIx: 0 },
        { name: "Bilal Khan", phone: "0345-2003004", branchIx: 1, courseIx: 1 },
      ],
    },
  ];

  let seq = 0;
  for (const def of entities) { seq += 1; await seedEntity(pool, def, seq); }

  console.log("\nSeed complete. Logins (all password: admin123):");
  console.log("  superadmin        — platform super admin");
  console.log("  ali-admin         — Ali Academy (entity_admin)");
  console.log("  ali-accountant    — Ali Academy (accountant, Main branch)");
  console.log("  bright-admin      — Bright Future Institute (entity_admin)");
  console.log("  bright-accountant — Bright Future Institute (accountant, Main branch)");
  process.exit(0);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
