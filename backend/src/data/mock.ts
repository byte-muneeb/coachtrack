// Mock data (PKR) used until the database layer is connected.
// Amounts are in Pakistani Rupees.

export const dashboard = {
  totalRevenueMTD: 1285000,
  outstandingFees: 342000,
  newRegistrations: 48,
  collectionEfficiency: 94.2,
  currency: "PKR",
};

export const students = [
  { id: "STU-2024-001", name: "Ahmed Raza", course: "MDCAT Prep", batch: "Morning A", status: "active", outstanding: 8500 },
  { id: "STU-2024-002", name: "Fatima Khan", course: "ECAT Prep", batch: "Evening B", status: "active", outstanding: 0 },
  { id: "STU-2024-003", name: "Bilal Aslam", course: "O-Level Math", batch: "Weekend", status: "pending", outstanding: 12000 },
];

export const courses = [
  { id: "C-01", name: "MDCAT Prep", durationMonths: 6, level: "Advanced", monthlyFee: 8000 },
  { id: "C-02", name: "ECAT Prep", durationMonths: 4, level: "Advanced", monthlyFee: 7000 },
  { id: "C-03", name: "O-Level Mathematics", durationMonths: 12, level: "Intermediate", monthlyFee: 5000 },
];

export const fees = [
  { id: "F-01", name: "Monthly Tuition", frequency: "monthly", amount: 8000, status: "active" },
  { id: "F-02", name: "Admission Fee", frequency: "one-time", amount: 5000, status: "active" },
  { id: "F-03", name: "Test Series Fee", frequency: "quarterly", amount: 3000, status: "active" },
];

export const vouchers = [
  { id: "VCH-9921", studentId: "STU-2024-001", amount: 8000, dueDate: "2026-08-05", status: "overdue", method: null },
  { id: "VCH-9922", studentId: "STU-2024-002", amount: 8000, dueDate: "2026-08-05", status: "paid", method: "JazzCash" },
];

export const paymentMethods = ["Cash", "JazzCash", "Easypaisa", "Raast", "Bank Transfer (IBFT)", "Bank Challan", "Cheque"];

export const teachers = [
  { id: "T-01", name: "Sir Kamran", batches: 3, students: 120, baseSalary: 60000, revenueSharePct: 10, payout: 84000 },
  { id: "T-02", name: "Miss Ayesha", batches: 2, students: 80, baseSalary: 50000, revenueSharePct: 8, payout: 66000 },
];

export const branches = [
  { id: "B-01", name: "Main Campus", students: 340, monthlyRevenue: 820000, outstanding: 180000, collection: 93 },
  { id: "B-02", name: "Gulshan Branch", students: 210, monthlyRevenue: 465000, outstanding: 84000, collection: 90 },
];

export const expenses = [
  { id: "E-01", date: "2026-07-02", category: "Rent", description: "Main campus rent", amount: 250000, paidVia: "Bank Transfer (IBFT)" },
  { id: "E-02", date: "2026-07-05", category: "Salaries", description: "Faculty payroll", amount: 480000, paidVia: "Bank Transfer (IBFT)" },
];

export const tests = [
  { id: "TST-01", name: "MDCAT Mock 1", subject: "Biology", totalMarks: 200, date: "2026-07-14", batch: "Morning A" },
  { id: "TST-02", name: "ECAT Mock 1", subject: "Physics", totalMarks: 100, date: "2026-07-16", batch: "Evening B" },
];

export const attendance = [
  { studentId: "STU-2024-001", date: "2026-07-20", status: "present" },
  { studentId: "STU-2024-003", date: "2026-07-20", status: "absent" },
];
