// Tiny fetch helper for the CoachTrack backend API.

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type Student = {
  id: number;
  registryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  address: string | null;
  guardianName: string | null;
  guardianRelation: string | null;
  photoUrl: string | null;
  course: string | null;
  batch: string | null;
  commencementDate: string | null;
  status: string;
  discountPct: number;
  scholarship: number;
  totalFee: number;
  outstanding: number;
  notes: string | null;
  branchId: number | null;
  createdAt: string;
  updatedAt: string;
};

export const TOKEN_KEY = "ct_token";
export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    ...init,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/login")) {
    // token missing/expired — force re-login
    setToken(null);
    if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
    throw new Error("Session expired — please sign in again.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const studentsApi = {
  list: (params: { search?: string; status?: string; branch?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set("search", params.search);
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.branch && params.branch !== "all") q.set("branch", params.branch);
    const qs = q.toString();
    return request<Student[]>(`/api/students${qs ? `?${qs}` : ""}`);
  },
  get: (id: number | string) => request<Student>(`/api/students/${id}`),
  create: (data: Partial<Student>) =>
    request<Student>("/api/students", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Student>) =>
    request<Student>(`/api/students/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) =>
    request<void>(`/api/students/${id}`, { method: "DELETE" }),
};

export type Batch = {
  id: number;
  courseId: number;
  name: string;
  timeSlot: string | null;
  teacher: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyFee: number;
  capacity: number | null;
  status: string;
};

export type Course = {
  id: number;
  name: string;
  code: string | null;
  level: string | null;
  durationMonths: number | null;
  description: string | null;
  admissionFee: number;
  monthlyFee: number;
  examFee: number;
  status: string;
  branchId?: number | null;
  batchCount?: number;
  batches?: Batch[];
  createdAt: string;
  updatedAt: string;
};

export const coursesApi = {
  list: (search?: string) =>
    request<Course[]>(`/api/courses${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  get: (id: number) => request<Course>(`/api/courses/${id}`),
  create: (data: Partial<Course>) =>
    request<Course>("/api/courses", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Course>) =>
    request<Course>(`/api/courses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/api/courses/${id}`, { method: "DELETE" }),
  addBatch: (courseId: number, data: Partial<Batch>) =>
    request<Batch>(`/api/courses/${courseId}/batches`, { method: "POST", body: JSON.stringify(data) }),
  updateBatch: (courseId: number, batchId: number, data: Partial<Batch>) =>
    request<Batch>(`/api/courses/${courseId}/batches/${batchId}`, { method: "PUT", body: JSON.stringify(data) }),
  removeBatch: (courseId: number, batchId: number) =>
    request<void>(`/api/courses/${courseId}/batches/${batchId}`, { method: "DELETE" }),
};

export type FeeComponent = {
  id: number;
  name: string;
  category: string | null;
  frequency: string | null;
  amount: number;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const feesApi = {
  list: () => request<FeeComponent[]>("/api/fees"),
  create: (data: Partial<FeeComponent>) =>
    request<FeeComponent>("/api/fees", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<FeeComponent>) =>
    request<FeeComponent>(`/api/fees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/api/fees/${id}`, { method: "DELETE" }),
};

export type Payment = {
  id: number;
  voucherId: number;
  amount: number;
  method: string | null;
  reference: string | null;
  receivedBy: string | null;
  paidAt: string;
};

export type VoucherItem = {
  id: number;
  voucherId: number;
  batchId: number | null;
  label: string | null;
  amount: number;
};

export type Voucher = {
  id: number;
  voucherNo: string;
  studentId: number;
  studentName?: string;
  studentRegistryId?: string;
  studentPhone?: string | null;
  description: string | null;
  amount: number;
  paidAmount: number;
  generateDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  billingMonth: string | null;
  status: string; // unpaid | partial | paid
  isOverdue?: number;
  feeComponentId: number | null;
  items?: VoucherItem[];
  payments?: Payment[];
  payment?: Payment; // returned right after recording a payment (for the receipt)
  createdAt: string;
  updatedAt: string;
};

export type GenerateResult = { month: string; created: number; transfersApplied: number };

export const vouchersApi = {
  list: (params: { studentId?: number; status?: string; search?: string; month?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.studentId) q.set("studentId", String(params.studentId));
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    if (params.month) q.set("month", params.month);
    const qs = q.toString();
    return request<Voucher[]>(`/api/vouchers${qs ? `?${qs}` : ""}`);
  },
  get: (id: number) => request<Voucher>(`/api/vouchers/${id}`),
  create: (data: { studentId: number; description?: string | null; amount: number; generateDate?: string | null; dueDate?: string | null; expiryDate?: string | null; feeComponentId?: number | null }) =>
    request<Voucher>("/api/vouchers", { method: "POST", body: JSON.stringify(data) }),
  recordPayment: (id: number, data: { amount: number; method?: string; reference?: string; receivedBy?: string }) =>
    request<Voucher>(`/api/vouchers/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
  generate: (data: { billingMonth: string; generateDate?: string | null; dueDate?: string | null; expiryDate?: string | null }) =>
    request<GenerateResult>("/api/vouchers/generate", { method: "POST", body: JSON.stringify(data) }),
  chargeExam: (data: { courseId: number; dueDate?: string | null }) =>
    request<{ created: number; course: string }>("/api/vouchers/charge-exam", { method: "POST", body: JSON.stringify(data) }),
  applyLateFees: () => request<{ applied: number; total: number; mode: string }>("/api/vouchers/apply-late-fees", { method: "POST" }),
  installments: (data: { studentId: number; totalAmount: number; count: number; description: string; firstDueDate?: string | null; intervalDays?: number }) =>
    request<{ created: number }>("/api/vouchers/installments", { method: "POST", body: JSON.stringify(data) }),
  statement: (studentId: number) =>
    request<{ student: { id: number; fullName: string; registryId: string }; rows: Array<{ date: string; type: string; ref: string; description: string; debit: number; credit: number; balance: number }>; totals: { billed: number; paid: number; balance: number } }>(`/api/vouchers/statement/${studentId}`),
  remove: (id: number) => request<void>(`/api/vouchers/${id}`, { method: "DELETE" }),
  paymentMethods: () => request<string[]>("/api/vouchers/meta/payment-methods"),
};

export type Enrollment = {
  id: number;
  studentId: number;
  batchId: number;
  courseId: number | null;
  monthlyFee: number;
  discount: number;
  status: string;
  startDate: string | null;
  batchName?: string | null;
  batchTimeSlot?: string | null;
  batchStatus?: string | null;
  courseName?: string | null;
  createdAt: string;
};

export type Transfer = {
  id: number;
  studentId: number;
  enrollmentId: number | null;
  fromBatchId: number | null;
  toBatchId: number;
  reason: string | null;
  effectiveMonth: string;
  status: string; // pending | applied
  studentName?: string;
  fromBatchName?: string | null;
  toBatchName?: string | null;
  createdAt: string;
  appliedAt: string | null;
};

export const enrollmentsApi = {
  list: (studentId: number) => request<Enrollment[]>(`/api/enrollments?studentId=${studentId}`),
  create: (data: { studentId: number; batchId: number; monthlyFee?: number; discount?: number; startDate?: string | null }) =>
    request<Enrollment>("/api/enrollments", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/api/enrollments/${id}`, { method: "DELETE" }),
  transfers: (studentId?: number) =>
    request<Transfer[]>(`/api/enrollments/transfers/list${studentId ? `?studentId=${studentId}` : ""}`),
  transfer: (data: { studentId: number; enrollmentId?: number; fromBatchId?: number; toBatchId: number; reason?: string }) =>
    request<Transfer>("/api/enrollments/transfer", { method: "POST", body: JSON.stringify(data) }),
};

export type Expense = {
  id: number;
  date: string;
  category: string | null;
  description: string | null;
  amount: number;
  paidVia: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ExpenseSummary = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  byCategory: Array<{ category: string; total: number }>;
};

export const expensesApi = {
  list: () => request<Expense[]>("/api/expenses"),
  summary: () => request<ExpenseSummary>("/api/expenses/summary"),
  create: (data: Partial<Expense>) => request<Expense>("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Expense>) => request<Expense>(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/api/expenses/${id}`, { method: "DELETE" }),
};

export type DashboardData = {
  selectedMonth: string;
  availableMonths: string[];
  revenueMTD: number;
  totalCollected: number;
  totalOutstanding: number;
  studentsCount: number;
  outstandingStudentsCount: number;
  newRegistrationsMTD: number;
  collectionEfficiency: number;
  monthlyTrend: Array<{ ym: string; collected: number }>;
  recentPayments: Array<{ amount: number; method: string | null; paidAt: string; studentName: string; voucherNo: string }>;
  outstandingStudents: Array<{ id: number; fullName: string; registryId: string; course: string | null; outstanding: number; overdueCount: number }>;
};

export type ReportFilters = { from?: string; to?: string; course?: string; status?: string };

export type ReportsData = {
  filters: { from: string | null; to: string | null; course: string | null; status: string | null };
  availableCourses: string[];
  totalRevenue: number;
  totalOutstanding: number;
  totalStudents: number;
  overdueVouchers: number;
  collectionEfficiency: number;
  monthlyCollections: Array<{ ym: string; collected: number }>;
  billingByCourse: Array<{ course: string; expected: number; students: number }>;
  defaulters: Array<{ id: number; fullName: string; registryId: string; course: string | null; outstanding: number; overdueCount: number }>;
};

export const statsApi = {
  dashboard: (month?: string) =>
    request<DashboardData>(`/api/dashboard${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  reports: (filters: ReportFilters = {}) => {
    const q = new URLSearchParams();
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (filters.course) q.set("course", filters.course);
    if (filters.status) q.set("status", filters.status);
    const qs = q.toString();
    return request<ReportsData>(`/api/reports${qs ? `?${qs}` : ""}`);
  },
};

export type InstituteProfile = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  currency: string;
  academicYear: string;
  voucherPrefix: string;
  voucherFooter: string;
  logoText: string;
  lateFeeMode: string; // none | fixed | percent
  lateFeeValue: string;
  autoGenDay: string;
};

export const settingsApi = {
  profile: () => request<InstituteProfile>("/api/settings/profile"),
  saveProfile: (data: Partial<InstituteProfile>) =>
    request<InstituteProfile>("/api/settings/profile", { method: "PUT", body: JSON.stringify(data) }),
};

export type Branch = {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  manager: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const branchesApi = {
  list: () => request<Branch[]>("/api/branches"),
  create: (data: Partial<Branch>) => request<Branch>("/api/branches", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Branch>) => request<Branch>(`/api/branches/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/api/branches/${id}`, { method: "DELETE" }),
};

export type Inquiry = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  interestedCourse: string | null;
  source: string | null;
  stage: string; // new | contacted | trial | enrolled | lost
  trialDate: string | null;
  followUpDate: string | null;
  notes: string | null;
  convertedStudentId: number | null;
  createdAt: string;
  updatedAt: string;
};

export const inquiriesApi = {
  list: (params: { stage?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.stage && params.stage !== "all") q.set("stage", params.stage);
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return request<Inquiry[]>(`/api/inquiries${qs ? `?${qs}` : ""}`);
  },
  create: (data: Partial<Inquiry>) => request<Inquiry>("/api/inquiries", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Inquiry>) => request<Inquiry>(`/api/inquiries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  convert: (id: number) => request<{ student: Student }>(`/api/inquiries/${id}/convert`, { method: "POST" }),
  remove: (id: number) => request<void>(`/api/inquiries/${id}`, { method: "DELETE" }),
};

export type ReminderRule = {
  id: number;
  offsetType: "before" | "on" | "after";
  offsetDays: number;
  channels: string | null;
  active: boolean;
};
export type ReminderSettings = { template: string; automationActive: boolean };
export type ReminderQueueItem = {
  studentName: string; voucherNo: string; amount: number; dueDate: string; scheduledFor: string; rule: string; channels: string;
};

export type AppUser = { id: number; username: string; fullName: string | null; role: string; status?: string; createdAt?: string };
export type AuditEntry = { id: number; userId: number | null; username: string | null; action: string; entity: string | null; entityId: string | null; detail: string | null; createdAt: string };

export const authApi = {
  login: (username: string, password: string) =>
    request<{ token: string; user: AppUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request<{ userId: number; username: string; role: string }>("/api/auth/me"),
  users: () => request<AppUser[]>("/api/auth/users"),
  createUser: (data: { username: string; password: string; fullName?: string; role?: string }) =>
    request<AppUser>("/api/auth/users", { method: "POST", body: JSON.stringify(data) }),
  removeUser: (id: number) => request<void>(`/api/auth/users/${id}`, { method: "DELETE" }),
};

export const auditApi = {
  list: () => request<AuditEntry[]>("/api/audit"),
};

export const remindersApi = {
  rules: () => request<ReminderRule[]>("/api/reminders/rules"),
  addRule: (data: Partial<ReminderRule>) => request<ReminderRule>("/api/reminders/rules", { method: "POST", body: JSON.stringify(data) }),
  updateRule: (id: number, data: Partial<ReminderRule>) => request<ReminderRule>(`/api/reminders/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeRule: (id: number) => request<void>(`/api/reminders/rules/${id}`, { method: "DELETE" }),
  settings: () => request<ReminderSettings>("/api/reminders/settings"),
  saveSettings: (data: Partial<ReminderSettings>) => request<{ ok: boolean }>("/api/reminders/settings", { method: "PUT", body: JSON.stringify(data) }),
  queue: () => request<{ pendingIntegration: boolean; queue: ReminderQueueItem[] }>("/api/reminders/queue"),
};
