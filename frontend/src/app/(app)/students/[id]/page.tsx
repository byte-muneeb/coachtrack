"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  studentsApi, enrollmentsApi, coursesApi, vouchersApi,
  type Student, type Enrollment, type Transfer, type Course, type Batch,
} from "@/lib/api";
import StatCard from "@/components/StatCard";
import { Select, numberGuard, noWheel } from "@/components/form";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const inputCls =
  "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md outline-none focus:border-secondary";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="font-label-md text-label-md text-on-surface-variant">{label}</p>
      <p className="font-body-md text-body-md text-on-surface">{value || "—"}</p>
    </div>
  );
}

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [student, setStudent] = useState<Student | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Student>>({});
  const [saving, setSaving] = useState(false);

  // enrollment / transfer helpers
  const [courses, setCourses] = useState<Course[]>([]);
  const [batchesByCourse, setBatchesByCourse] = useState<Record<number, Batch[]>>({});
  const [addCourse, setAddCourse] = useState("");
  const [addBatch, setAddBatch] = useState("");
  const [addDiscount, setAddDiscount] = useState(0);
  const [transferFor, setTransferFor] = useState<Enrollment | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, en, tr] = await Promise.all([
        studentsApi.get(id),
        enrollmentsApi.list(Number(id)),
        enrollmentsApi.transfers(Number(id)),
      ]);
      setStudent(s);
      setDraft(s);
      setEnrollments(en);
      setTransfers(tr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { coursesApi.list().then(setCourses).catch(() => {}); }, []);

  const set = (k: keyof Student) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((prev) => ({ ...prev, [k]: e.target.value }));

  async function ensureBatches(courseId: number) {
    if (!courseId || batchesByCourse[courseId]) return;
    try {
      const full = await coursesApi.get(courseId);
      setBatchesByCourse((p) => ({ ...p, [courseId]: full.batches || [] }));
    } catch { setBatchesByCourse((p) => ({ ...p, [courseId]: [] })); }
  }

  async function save() {
    if (!student) return;
    setSaving(true);
    try {
      const updated = await studentsApi.update(student.id, {
        fullName: draft.fullName, email: draft.email, phone: draft.phone, address: draft.address,
        guardianName: draft.guardianName, guardianRelation: draft.guardianRelation, status: draft.status,
        discountPct: Number(draft.discountPct) || 0, scholarship: Number(draft.scholarship) || 0,
        notes: draft.notes,
      });
      setStudent(updated);
      setDraft(updated);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!student) return;
    if (!confirm(`Delete ${student.fullName}?`)) return;
    try {
      await studentsApi.remove(student.id);
      router.push("/students");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function addEnrollment() {
    if (!student || !addBatch) return;
    try {
      await enrollmentsApi.create({ studentId: student.id, batchId: Number(addBatch), discount: addDiscount });
      setAddCourse(""); setAddBatch(""); setAddDiscount(0);
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Could not enroll"); }
  }
  async function removeEnrollment(en: Enrollment) {
    if (!confirm(`Remove enrollment in ${en.courseName || "course"} — ${en.batchName || "batch"}?`)) return;
    try { await enrollmentsApi.remove(en.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Could not remove"); }
  }

  const monthlyTotal = enrollments.filter((e) => e.status === "active").reduce((s, e) => s + Math.max(0, (e.monthlyFee || 0) - (e.discount || 0)), 0);
  const addCourseId = Number(addCourse) || 0;
  const addBatchOptions = addCourseId ? batchesByCourse[addCourseId] : undefined;

  if (loading)
    return <main className="ml-[280px] pt-16 p-lg font-body-md text-on-surface-variant">Loading…</main>;
  if (error || !student)
    return (
      <main className="ml-[280px] pt-16 p-lg">
        <p className="font-body-md text-error">{error || "Student not found"}</p>
        <Link href="/students" className="mt-md inline-block text-secondary underline">← Back to registry</Link>
      </main>
    );

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1100px] space-y-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-md">
            <Link href="/students" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-on-surface-variant">arrow_back</span>
            </Link>
            <div>
              <h1 className="font-display text-[26px] font-bold tracking-tight text-primary">{student.fullName}</h1>
              <p className="font-mono-data text-mono-data text-on-surface-variant">
                {student.registryId} · <span className="capitalize">{student.status}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-sm">
            {editing ? (
              <>
                <button onClick={() => { setEditing(false); setDraft(student); }} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
                <button onClick={save} disabled={saving} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">
                  <span className="material-symbols-outlined text-[18px]">save</span>{saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStatementOpen(true)} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">
                  <span className="material-symbols-outlined text-[18px]">description</span>Statement
                </button>
                <button onClick={() => setEditing(true)} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-primary hover:bg-surface-container-high">
                  <span className="material-symbols-outlined text-[18px]">edit</span>Edit
                </button>
                <button onClick={remove} className="flex items-center gap-xs rounded-lg border border-error px-md py-sm font-label-md text-label-md text-error hover:bg-error-container">
                  <span className="material-symbols-outlined text-[18px]">delete</span>Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
          <StatCard label="Monthly Fee (active)" value={rs(monthlyTotal)} icon="payments" tone="blue" />
          <StatCard label="Outstanding" value={rs(student.outstanding)} icon="account_balance_wallet"
            tone={student.outstanding > 0 ? "red" : "green"} valueClass={student.outstanding > 0 ? "text-error" : "text-primary"} />
          <StatCard label="Enrolled Batches" value={String(enrollments.filter((e) => e.status === "active").length)} icon="school" tone="secondary" />
        </div>

        {/* Enrollments */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Batch Enrollments</h2>
          {enrollments.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant">No batch enrollments yet. Add one below.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-outline-variant">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
                  <tr>
                    <th className="px-md py-sm">Course</th>
                    <th className="px-md py-sm">Batch</th>
                    <th className="px-md py-sm">Monthly Fee</th>
                    <th className="px-md py-sm">Discount</th>
                    <th className="px-md py-sm">Net / mo</th>
                    <th className="px-md py-sm">Status</th>
                    <th className="px-md py-sm text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {enrollments.map((en) => (
                    <tr key={en.id} className="hover:bg-secondary/5">
                      <td className="px-md py-sm font-body-md text-body-md">{en.courseName || "—"}</td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{en.batchName || "—"}{en.batchTimeSlot ? ` (${en.batchTimeSlot})` : ""}</td>
                      <td className="px-md py-sm font-mono-data text-mono-data">{rs(en.monthlyFee)}</td>
                      <td className="px-md py-sm font-mono-data text-mono-data">{en.discount > 0 ? <span className="text-green-700">− {rs(en.discount)}</span> : "—"}</td>
                      <td className="px-md py-sm font-mono-data text-mono-data font-semibold text-primary">{rs(Math.max(0, en.monthlyFee - (en.discount || 0)))}</td>
                      <td className="px-md py-sm"><span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${en.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{en.status}</span></td>
                      <td className="px-md py-sm">
                        <div className="flex items-center justify-end gap-xs">
                          <button onClick={() => setTransferFor(en)} className="rounded-md border border-outline-variant px-sm py-[3px] font-label-md text-label-md text-primary hover:bg-surface-container-high">Transfer</button>
                          <button onClick={() => removeEnrollment(en)} className="flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-container" title="Remove"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add enrollment */}
          <div className="mt-md flex flex-wrap items-end gap-sm">
            <label className="flex flex-1 min-w-[180px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Course</span>
              <Select value={addCourse} onChange={(e) => { setAddCourse(e.target.value); setAddBatch(""); ensureBatches(Number(e.target.value)); }}>
                <option value="">Select course…</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>
            <label className="flex flex-1 min-w-[180px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Batch</span>
              <Select value={addBatch} onChange={(e) => setAddBatch(e.target.value)} disabled={!addCourseId}>
                <option value="">{!addCourseId ? "Pick a course" : addBatchOptions === undefined ? "Loading…" : "Select batch…"}</option>
                {(addBatchOptions || []).map((b) => <option key={b.id} value={b.id}>{b.name} — {rs(b.monthlyFee || 0)}/mo</option>)}
              </Select>
            </label>
            <label className="flex w-[150px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Discount (Rs)</span>
              <input type="number" min={0} inputMode="numeric" onKeyDown={numberGuard} onWheel={noWheel} className={inputCls} value={addDiscount} onChange={(e) => setAddDiscount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <button onClick={addEnrollment} disabled={!addBatch} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">add</span> Enroll
            </button>
          </div>

          {/* Pending / recent transfers */}
          {transfers.length > 0 && (
            <div className="mt-lg">
              <h3 className="mb-sm font-label-md text-label-md uppercase text-on-surface-variant">Batch Transfers</h3>
              <ul className="space-y-xs">
                {transfers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant px-md py-sm font-body-md text-body-md">
                    <span className="material-symbols-outlined text-[18px] text-secondary">swap_horiz</span>
                    <span>{t.fromBatchName || "—"} → <span className="font-semibold text-primary">{t.toBatchName || "—"}</span></span>
                    <span className={`rounded-full px-sm py-[1px] font-label-md text-label-md ${t.status === "applied" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                      {t.status === "applied" ? "applied" : `effective ${t.effectiveMonth}`}
                    </span>
                    {t.reason && <span className="text-on-surface-variant">· {t.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Details / edit form */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Details</h2>
          {editing ? (
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Full Name</span><input className={inputCls} value={draft.fullName || ""} onChange={set("fullName")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Phone</span><input type="tel" className={inputCls} value={draft.phone || ""} onChange={set("phone")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Email</span><input type="email" className={inputCls} value={draft.email || ""} onChange={set("email")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Address</span><input className={inputCls} value={draft.address || ""} onChange={set("address")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Guardian</span><input className={inputCls} value={draft.guardianName || ""} onChange={set("guardianName")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Relation</span><input className={inputCls} value={draft.guardianRelation || ""} onChange={set("guardianRelation")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Status</span>
                <select className={inputCls} value={draft.status || "active"} onChange={set("status")}>
                  {["active", "pending", "graduated", "suspended"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Scholarship (Rs / month)</span><input type="number" min={0} inputMode="numeric" onKeyDown={numberGuard} onWheel={noWheel} className={inputCls} value={draft.scholarship ?? 0} onChange={set("scholarship")} /></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Notes</span><input className={inputCls} value={draft.notes || ""} onChange={set("notes")} /></label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-lg sm:grid-cols-3">
              <Row label="Phone" value={student.phone} />
              <Row label="Email" value={student.email} />
              <Row label="Address" value={student.address} />
              <Row label="Guardian" value={student.guardianName ? `${student.guardianName} (${student.guardianRelation || "—"})` : null} />
              <Row label="Scholarship" value={rs(student.scholarship)} />
              <Row label="Notes" value={student.notes} />
            </div>
          )}
        </section>
      </div>

      {transferFor && (
        <TransferDialog
          enrollment={transferFor}
          studentId={student.id}
          courses={courses}
          batchesByCourse={batchesByCourse}
          ensureBatches={ensureBatches}
          onClose={() => setTransferFor(null)}
          onDone={async () => { setTransferFor(null); await load(); }}
        />
      )}
      {statementOpen && <StatementModal studentId={student.id} onClose={() => setStatementOpen(false)} />}
    </main>
  );
}

function StatementModal({ studentId, onClose }: { studentId: number; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof vouchersApi.statement>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    vouchersApi.statement(studentId).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [studentId]);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/50 p-lg backdrop-blur-sm print:static print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="w-full max-w-[760px]">
        <div className="mb-md flex items-center justify-end gap-sm no-print">
          <button onClick={() => window.print()} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">print</span> Print
          </button>
          <button onClick={onClose} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">Close</button>
        </div>
        <div className="print-area rounded-md border border-neutral-300 bg-white p-xl text-black">
          {error ? (
            <p className="text-error">{error}</p>
          ) : !data ? (
            <p className="text-neutral-600">Loading…</p>
          ) : (
            <>
              <div className="border-b-2 border-black pb-sm">
                <p className="text-[18px] font-bold">Account Statement</p>
                <p className="text-[13px] text-neutral-700">{data.student.fullName} · {data.student.registryId}</p>
              </div>
              <table className="mt-md w-full text-left text-[12px]">
                <thead><tr className="border-b border-black uppercase text-neutral-600">
                  <th className="py-[6px]">Date</th><th className="py-[6px]">Ref</th><th className="py-[6px]">Description</th>
                  <th className="py-[6px] text-right">Debit</th><th className="py-[6px] text-right">Credit</th><th className="py-[6px] text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr><td colSpan={6} className="py-md text-center text-neutral-500">No transactions yet.</td></tr>
                  ) : data.rows.map((r, i) => (
                    <tr key={i} className="border-b border-dashed border-neutral-300">
                      <td className="py-[5px]">{r.date}</td>
                      <td className="py-[5px] font-mono-data">{r.ref}</td>
                      <td className="py-[5px]">{r.description}</td>
                      <td className="py-[5px] text-right font-mono-data">{r.debit ? rs(r.debit) : ""}</td>
                      <td className="py-[5px] text-right font-mono-data">{r.credit ? rs(r.credit) : ""}</td>
                      <td className="py-[5px] text-right font-mono-data">{rs(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-md flex justify-end gap-xl border-t-2 border-black pt-sm text-[13px]">
                <span>Billed: <b>{rs(data.totals.billed)}</b></span>
                <span>Paid: <b>{rs(data.totals.paid)}</b></span>
                <span>Balance: <b>{rs(data.totals.balance)}</b></span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TransferDialog({
  enrollment, studentId, courses, batchesByCourse, ensureBatches, onClose, onDone,
}: {
  enrollment: Enrollment;
  studentId: number;
  courses: Course[];
  batchesByCourse: Record<number, Batch[]>;
  ensureBatches: (courseId: number) => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [courseId, setCourseId] = useState("");
  const [toBatch, setToBatch] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const batches = Number(courseId) ? batchesByCourse[Number(courseId)] : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toBatch) { setErr("Choose a target batch"); return; }
    if (!reason.trim()) { setErr("A reason is required"); return; }
    setSaving(true); setErr(null);
    try {
      await enrollmentsApi.transfer({
        studentId,
        enrollmentId: enrollment.id,
        fromBatchId: enrollment.batchId,
        toBatchId: Number(toBatch),
        reason: reason.trim(),
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Transfer failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[520px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">Transfer Batch</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          From <span className="font-semibold text-on-surface">{enrollment.courseName} — {enrollment.batchName}</span>. The transfer takes effect from <span className="font-semibold text-primary">next month</span>.
        </p>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Course</span>
            <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setToBatch(""); ensureBatches(Number(e.target.value)); }}>
              <option value="">Select course…</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Target Batch</span>
            <Select value={toBatch} onChange={(e) => setToBatch(e.target.value)} disabled={!courseId}>
              <option value="">{!courseId ? "Pick a course" : batches === undefined ? "Loading…" : "Select batch…"}</option>
              {(batches || []).map((b) => <option key={b.id} value={b.id}>{b.name} — {"Rs " + Number(b.monthlyFee || 0).toLocaleString("en-PK")}/mo</option>)}
            </Select>
          </label>
        </div>
        <label className="flex flex-col gap-xs">
          <span className="font-label-md text-label-md text-on-surface-variant">Reason <span className="text-error">*</span></span>
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Shifted to evening batch on request" required />
        </label>
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Scheduling…" : "Schedule Transfer"}</button>
        </div>
      </form>
    </div>
  );
}
