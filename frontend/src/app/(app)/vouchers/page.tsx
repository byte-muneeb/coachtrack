"use client";

import { useCallback, useEffect, useState } from "react";
import {
  vouchersApi, studentsApi, feesApi, settingsApi, coursesApi,
  type Voucher, type Student, type FeeComponent, type InstituteProfile, type Payment, type Course,
} from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Field, TextInput, NumberInput, Select, inputCls } from "@/components/form";
import { exportCsv } from "@/lib/exportCsv";
import { fmtDate } from "@/lib/date";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const STATUS = ["all", "unpaid", "partial", "paid"];

// yyyy-MM helpers for the generation dialog defaults.
function thisMonth(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

function StatusPill({ v }: { v: Voucher }) {
  if (v.status !== "paid" && v.isOverdue)
    return <span className="rounded-full bg-error-container px-sm py-[2px] font-label-md text-label-md text-on-error-container">Overdue</span>;
  const map: Record<string, string> = {
    paid: "bg-green-100 text-green-800",
    partial: "bg-amber-100 text-amber-800",
    unpaid: "bg-surface-container-high text-on-surface-variant",
  };
  return <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${map[v.status] || ""}`}>{v.status}</span>;
}

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeComponent[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [profile, setProfile] = useState<InstituteProfile | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [installmentOpen, setInstallmentOpen] = useState(false);
  const [lateBusy, setLateBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  function exportVouchersCsv() {
    exportCsv("vouchers", vouchers, [
      { header: "Voucher", value: (v) => v.voucherNo },
      { header: "Student", value: (v) => v.studentName || "" },
      { header: "Registry ID", value: (v) => v.studentRegistryId || "" },
      { header: "Description", value: (v) => v.description || "" },
      { header: "Due", value: (v) => fmtDate(v.dueDate) },
      { header: "Amount", value: (v) => v.amount },
      { header: "Paid", value: (v) => v.paidAmount },
      { header: "Status", value: (v) => v.status },
    ]);
  }

  async function applyLateFees() {
    if (!confirm("Apply the configured late fee to all overdue, unpaid vouchers?")) return;
    setLateBusy(true);
    try {
      const r = await vouchersApi.applyLateFees();
      alert(`Late fee applied to ${r.applied} voucher${r.applied === 1 ? "" : "s"} (Rs ${r.total.toLocaleString("en-PK")} total).`);
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setLateBusy(false); }
  }
  const [payFor, setPayFor] = useState<Voucher | null>(null);
  const [printFor, setPrintFor] = useState<Voucher | null>(null);
  const [receipt, setReceipt] = useState<{ voucher: Voucher; payment: Payment } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkPrint, setBulkPrint] = useState<number[] | null>(null);

  function toggle(id: number) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll(ids: number[], on: boolean) {
    setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} selected voucher(s)? This cannot be undone.`)) return;
    for (const id of selected) { try { await vouchersApi.remove(id); } catch { /* skip */ } }
    setSelected(new Set());
    await load();
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setVouchers(await vouchersApi.list({ search, status })); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    studentsApi.list().then(setStudents).catch(() => {});
    feesApi.list().then(setFees).catch(() => {});
    coursesApi.list().then(setCourses).catch(() => {});
    vouchersApi.paymentMethods().then(setMethods).catch(() => setMethods([]));
    settingsApi.profile().then(setProfile).catch(() => {});
  }, []);

  async function del(v: Voucher) {
    if (!confirm(`Delete voucher ${v.voucherNo}?`)) return;
    try { await vouchersApi.remove(v.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
  }
  // Fetch full voucher (with line items) before printing.
  async function openPrint(v: Voucher) {
    try { setPrintFor(await vouchersApi.get(v.id)); }
    catch { setPrintFor(v); }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1440px] space-y-lg print:hidden">
        <PageHeader
          title="Vouchers & Collections"
          subtitle="Generate monthly vouchers, print them, and record payments."
          icon="receipt_long"
          actions={
            <div className="flex items-center gap-sm">
              {/* Primary actions — the two things you do most often. */}
              <button onClick={() => setGenerateOpen(true)} className="flex items-center gap-xs rounded-lg border border-secondary px-md py-sm font-label-md text-label-md text-secondary hover:bg-secondary/10">
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span> Generate Monthly
              </button>
              <button onClick={() => setCreateOpen(true)} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
                <span className="material-symbols-outlined text-[18px]">add_card</span> New Voucher
              </button>

              {/* Everything occasional lives here, so the toolbar stays calm. */}
              <div className="relative">
                <button onClick={() => setMoreOpen((o) => !o)} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">
                  <span className="material-symbols-outlined text-[18px]">more_horiz</span> More
                  <span className="material-symbols-outlined text-[18px]">{moreOpen ? "arrow_drop_up" : "arrow_drop_down"}</span>
                </button>
                {moreOpen && (
                  <>
                    <button aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[240px] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest py-xs shadow-[var(--shadow-pop)]">
                      <button onClick={() => { setMoreOpen(false); applyLateFees(); }} disabled={lateBusy} className="flex w-full items-center gap-sm px-md py-sm text-left font-body-md text-body-md text-on-surface hover:bg-surface-container-low disabled:opacity-60">
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">gavel</span> {lateBusy ? "Applying…" : "Apply late fees"}
                      </button>
                      <button onClick={() => { setMoreOpen(false); setExamOpen(true); }} className="flex w-full items-center gap-sm px-md py-sm text-left font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">quiz</span> Charge exam fee
                      </button>
                      <button onClick={() => { setMoreOpen(false); setInstallmentOpen(true); }} className="flex w-full items-center gap-sm px-md py-sm text-left font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">splitscreen</span> Installment plan
                      </button>
                      <div className="my-xs h-px bg-outline-variant" />
                      <button onClick={() => { setMoreOpen(false); exportVouchersCsv(); }} className="flex w-full items-center gap-sm px-md py-sm text-left font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">download</span> Export CSV
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          }
        />

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-sm rounded-lg border border-secondary bg-secondary/5 px-md py-sm">
            <span className="font-label-md text-label-md text-on-surface">{selected.size} selected</span>
            <div className="flex items-center gap-sm">
              <button onClick={() => setBulkPrint(Array.from(selected))} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
                <span className="material-symbols-outlined text-[18px]">print</span> Print {selected.size}
              </button>
              <button onClick={bulkDelete} className="flex items-center gap-xs rounded-lg border border-error px-md py-sm font-label-md text-label-md text-error hover:bg-error-container">
                <span className="material-symbols-outlined text-[18px]">delete</span> Delete {selected.size}
              </button>
              <button onClick={() => setSelected(new Set())} className="font-label-md text-label-md text-on-surface-variant hover:underline">Clear</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex flex-1 min-w-[240px] items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by student name, roll no, phone, or voucher #…" className="w-full bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant" />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto capitalize`}>
            {STATUS.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s === "unpaid" ? "Unpaid & partial" : s}</option>)}
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-secondary)]"
                    checked={vouchers.length > 0 && vouchers.every((v) => selected.has(v.id))}
                    onChange={(e) => toggleAll(vouchers.map((v) => v.id), e.target.checked)} />
                </th>
                <th className="px-md py-sm">Voucher</th>
                <th className="px-md py-sm">Student</th>
                <th className="px-md py-sm">Description</th>
                <th className="px-md py-sm">Due</th>
                <th className="px-md py-sm">Amount</th>
                <th className="px-md py-sm">Paid</th>
                <th className="px-md py-sm">Status</th>
                <th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={9} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={9} className="px-md py-xl text-center text-error font-body-md">{error} — is the backend running on :4000?</td></tr>
              ) : vouchers.length === 0 ? (
                <tr><td colSpan={9} className="px-md py-xl text-center text-on-surface-variant font-body-md">No vouchers found. Generate monthly vouchers or create one.</td></tr>
              ) : vouchers.map((v) => {
                const remaining = v.amount - v.paidAmount;
                return (
                  <tr key={v.id} className={`hover:bg-secondary/5 ${selected.has(v.id) ? "bg-secondary/5" : ""}`}>
                    <td className="px-md py-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--color-secondary)]" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                    </td>
                    <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{v.voucherNo}</td>
                    <td className="px-md py-sm font-body-md text-body-md">{v.studentName}<div className="font-label-md text-label-md text-on-surface-variant">{v.studentRegistryId}</div></td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{v.description || "—"}</td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{fmtDate(v.dueDate) || "—"}</td>
                    <td className="px-md py-sm font-mono-data text-mono-data">{rs(v.amount)}</td>
                    <td className="px-md py-sm font-mono-data text-mono-data">{rs(v.paidAmount)}</td>
                    <td className="px-md py-sm"><StatusPill v={v} /></td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-xs">
                        <button onClick={() => openPrint(v)} className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high" title="Print voucher">
                          <span className="material-symbols-outlined text-[20px]">print</span>
                        </button>
                        {remaining > 0 && (
                          <button onClick={() => setPayFor(v)} className="rounded-md bg-secondary px-sm py-[4px] font-label-md text-label-md text-on-secondary hover:opacity-90">Record Payment</button>
                        )}
                        <button onClick={() => del(v)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete"><span className="material-symbols-outlined text-[20px]">delete</span></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && <CreateVoucher students={students} fees={fees} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />}
      {generateOpen && <GenerateDialog onClose={() => setGenerateOpen(false)} onDone={() => { setGenerateOpen(false); load(); }} />}
      {examOpen && <ChargeExamDialog courses={courses} onClose={() => setExamOpen(false)} onDone={() => { setExamOpen(false); load(); }} />}
      {installmentOpen && <InstallmentDialog students={students} onClose={() => setInstallmentOpen(false)} onDone={() => { setInstallmentOpen(false); load(); }} />}
      {payFor && (
        <RecordPayment
          voucher={payFor}
          methods={methods}
          onClose={() => setPayFor(null)}
          onSaved={(voucher, payment) => { setPayFor(null); load(); if (payment) setReceipt({ voucher, payment }); }}
        />
      )}
      {printFor && <VoucherPrint voucher={printFor} profile={profile} onClose={() => setPrintFor(null)} />}
      {bulkPrint && <BulkVoucherPrint ids={bulkPrint} profile={profile} onClose={() => setBulkPrint(null)} />}
      {receipt && <ReceiptWindow voucher={receipt.voucher} payment={receipt.payment} profile={profile} onClose={() => setReceipt(null)} />}
    </main>
  );
}

/* ------------------------------ Generate monthly ------------------------------ */
function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [month, setMonth] = useState(thisMonth());
  const [genDate, setGenDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Default due = 10th, expiry = last day, whenever the month changes.
  useEffect(() => {
    setDueDate(`${month}-10`);
    setExpiryDate(lastDayOf(month));
  }, [month]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const r = await vouchersApi.generate({ billingMonth: month, generateDate: genDate, dueDate, expiryDate });
      setResult(`Generated ${r.created} voucher${r.created === 1 ? "" : "s"} for ${month}` + (r.transfersApplied ? ` · ${r.transfersApplied} transfer(s) applied` : ""));
      setTimeout(onDone, 1200);
    } catch (e) { setErr(e instanceof Error ? e.message : "Generation failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[520px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">Generate Monthly Vouchers</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Creates one combined voucher per student for their active batch enrollments. Students who already have a voucher for the month are skipped, and any pending batch transfers effective this month are applied first.
        </p>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        {result && <div className="rounded-lg border border-green-300 bg-green-50 px-md py-sm font-body-md text-body-md text-green-800">{result}</div>}
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field label="Billing Month" required>
            <TextInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
          <Field label="Generate Date">
            <TextInput type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} />
          </Field>
          <Field label="Due Date">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Expiry Date">
            <TextInput type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Generating…" : "Generate for all active students"}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Charge exam fee ------------------------------ */
function ChargeExamDialog({ courses, onClose, onDone }: { courses: Course[]; onClose: () => void; onDone: () => void }) {
  const [courseId, setCourseId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const selected = courses.find((c) => String(c.id) === courseId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!courseId) { setErr("Select a course"); return; }
    setSaving(true); setErr(null);
    try {
      const r = await vouchersApi.chargeExam({ courseId: Number(courseId), dueDate: dueDate || null });
      setResult(`Charged exam fee to ${r.created} student${r.created === 1 ? "" : "s"} of ${r.course}.`);
      setTimeout(onDone, 1200);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[480px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">Charge Exam Fee</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">Creates a one-time exam-fee voucher (from the course’s exam fee) for every active student enrolled in the selected course.</p>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        {result && <div className="rounded-lg border border-green-300 bg-green-50 px-md py-sm font-body-md text-body-md text-green-800">{result}</div>}
        <Field label="Course" required>
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
            <option value="">Select course…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name} — exam fee {rs(c.examFee)}</option>)}
          </Select>
        </Field>
        {selected && selected.examFee <= 0 && (
          <p className="font-label-md text-label-md text-error">This course has no exam fee set. Set it in Courses first.</p>
        )}
        <Field label="Due date (optional)">
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving || (!!selected && selected.examFee <= 0)} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Charging…" : "Charge exam fee"}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Installment plan ------------------------------ */
function InstallmentDialog({ students, onClose, onDone }: { students: Student[]; onClose: () => void; onDone: () => void }) {
  const [studentId, setStudentId] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [count, setCount] = useState(3);
  const [description, setDescription] = useState("Installment Plan");
  const [firstDueDate, setFirstDueDate] = useState(today());
  const [intervalDays, setIntervalDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const per = count > 0 ? Math.floor(totalAmount / count) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) { setErr("Select a student"); return; }
    if (totalAmount <= 0 || count < 1) { setErr("Enter a total amount and number of installments"); return; }
    setSaving(true); setErr(null);
    try {
      await vouchersApi.installments({ studentId: Number(studentId), totalAmount, count, description, firstDueDate: firstDueDate || null, intervalDays });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">Installment Plan</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">Splits a total into equal scheduled vouchers (the last absorbs any rounding).</p>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        <Field label="Student" required>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
            <option value="">Select a student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.registryId})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Total Amount (Rs)" required><NumberInput value={totalAmount} onValueChange={setTotalAmount} required /></Field>
          <Field label="Number of installments" required><NumberInput value={count} onValueChange={setCount} min={1} max={24} required /></Field>
          <Field label="First due date"><TextInput type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} /></Field>
          <Field label="Interval (days)"><NumberInput value={intervalDays} onValueChange={setIntervalDays} min={1} /></Field>
        </div>
        <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {totalAmount > 0 && count > 0 && (
          <p className="font-label-md text-label-md text-on-surface-variant">≈ {rs(per)} × {count} installments, every {intervalDays} days.</p>
        )}
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Creating…" : "Create installments"}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Bulk voucher print ------------------------------ */
function BulkVoucherPrint({ ids, profile, onClose }: { ids: number[]; profile: InstituteProfile | null; onClose: () => void }) {
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  useEffect(() => {
    Promise.all(ids.map((id) => vouchersApi.get(id).catch(() => null)))
      .then((vs) => setVouchers(vs.filter(Boolean) as Voucher[]));
  }, [ids]);
  const name = profile?.name || "Coaching Centre";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/50 p-lg backdrop-blur-sm print:static print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="w-full max-w-[760px]">
        <div className="mb-md flex items-center justify-end gap-sm no-print">
          <button onClick={() => window.print()} disabled={!vouchers} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">
            <span className="material-symbols-outlined text-[18px]">print</span> Print {ids.length}
          </button>
          <button onClick={onClose} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">Close</button>
        </div>
        {!vouchers ? (
          <div className="rounded-md bg-white p-xl text-center text-neutral-600">Loading {ids.length} vouchers…</div>
        ) : (
          <div className="space-y-lg">
            {vouchers.map((v) => {
              const remaining = v.amount - v.paidAmount;
              const items = v.items && v.items.length ? v.items : [{ id: 0, label: v.description || "Fee", amount: v.amount, voucherId: v.id, batchId: null }];
              return (
                <div key={v.id} className="print-area rounded-md border border-neutral-300 bg-white p-lg text-black" style={{ breakAfter: "page" }}>
                  <div className="flex items-start justify-between border-b-2 border-black pb-sm">
                    <div><p className="text-[16px] font-bold">{name}</p><p className="text-[11px] text-neutral-600">Fee Voucher</p></div>
                    <div className="text-right"><p className="font-mono-data text-[13px] font-bold">{v.voucherNo}</p>{v.billingMonth ? <p className="text-[11px] text-neutral-600">{v.billingMonth}</p> : null}</div>
                  </div>
                  <div className="mt-sm flex justify-between text-[12px]">
                    <span>{v.studentName} ({v.studentRegistryId})</span>
                    <span>Due: {fmtDate(v.dueDate) || "—"}</span>
                  </div>
                  <table className="mt-sm w-full text-left text-[12px]">
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-dashed border-neutral-300"><td className="py-[4px]">{it.label}</td><td className="py-[4px] text-right font-mono-data">{rs(it.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-sm flex justify-between border-t-2 border-black pt-[6px] text-[13px] font-bold">
                    <span>Amount Payable</span><span className="font-mono-data">{rs(remaining > 0 ? remaining : 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Printable voucher ------------------------------ */
function VoucherPrint({ voucher, profile, onClose }: { voucher: Voucher; profile: InstituteProfile | null; onClose: () => void }) {
  const remaining = voucher.amount - voucher.paidAmount;
  const paid = remaining <= 0;
  const name = profile?.name || "Coaching Centre";
  const line2 = [profile?.address, profile?.city].filter(Boolean).join(", ");
  const items = voucher.items && voucher.items.length > 0 ? voucher.items : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/50 p-lg backdrop-blur-sm print:static print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="w-full max-w-[760px]">
        <div className="mb-md flex items-center justify-end gap-sm no-print">
          <button onClick={() => window.print()} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">print</span> Print
          </button>
          <button onClick={onClose} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">Close</button>
        </div>

        <div className="print-area relative overflow-hidden rounded-2xl border border-outline-variant bg-white text-on-surface shadow-pop">
          {/* header band */}
          <div className="relative flex items-start justify-between bg-gradient-to-r from-[#0d1a33] via-[#0a1f45] to-[#0058be] px-xl py-lg text-white">
            <div className="flex items-center gap-md">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20"><span className="material-symbols-outlined text-[30px]">school</span></span>
              <div>
                <p className="text-[22px] font-bold leading-tight">{name}</p>
                {profile?.tagline ? <p className="text-[12px] text-white/70">{profile.tagline}</p> : null}
                <p className="text-[11px] text-white/60">{[line2, profile?.phone ? `Tel: ${profile.phone}` : ""].filter(Boolean).join("  ·  ")}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Fee Voucher</p>
              <p className="font-mono-data text-[16px] font-bold">{voucher.voucherNo}</p>
              {voucher.billingMonth ? <p className="text-[11px] text-white/60">{voucher.billingMonth}</p> : null}
            </div>
          </div>

          <div className="relative px-xl py-lg">
            {/* PAID watermark */}
            {paid && (
              <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] rounded-2xl border-4 border-green-500/30 px-lg py-xs text-[52px] font-black tracking-widest text-green-500/15">
                PAID
              </span>
            )}

            {/* meta panel */}
            <div className="grid grid-cols-3 gap-md rounded-xl border border-outline-variant bg-surface-container-low p-md">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Student</p><p className="text-[14px] font-semibold text-primary">{voucher.studentName}</p><p className="font-mono-data text-[11px] text-on-surface-variant">{voucher.studentRegistryId}</p></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Generated</p><p className="text-[14px] text-on-surface">{fmtDate(voucher.generateDate) || "—"}</p></div>
              <div className="text-right"><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Due · Expiry</p><p className="text-[14px] font-semibold text-primary">{fmtDate(voucher.dueDate) || "—"}</p><p className="text-[11px] text-error">exp {fmtDate(voucher.expiryDate) || "—"}</p></div>
            </div>

            {/* items */}
            <table className="mt-lg w-full text-left">
              <thead><tr className="border-b-2 border-primary/15 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant"><th className="pb-[6px]">Description</th><th className="pb-[6px] text-right">Amount</th></tr></thead>
              <tbody>
                {items ? items.map((it) => (
                  <tr key={it.id} className="border-b border-dashed border-outline-variant"><td className="py-[7px] text-[13px]">{it.label}</td><td className="py-[7px] text-right font-mono-data text-[13px]">{rs(it.amount)}</td></tr>
                )) : (
                  <tr className="border-b border-dashed border-outline-variant"><td className="py-[7px] text-[13px]">{voucher.description || "Fee"}</td><td className="py-[7px] text-right font-mono-data text-[13px]">{rs(voucher.amount)}</td></tr>
                )}
                <tr className="border-b border-dashed border-outline-variant"><td className="py-[7px] text-[13px] text-on-surface-variant">Total Billed</td><td className="py-[7px] text-right font-mono-data text-[13px]">{rs(voucher.amount)}</td></tr>
                {voucher.paidAmount > 0 && (
                  <tr className="border-b border-dashed border-outline-variant"><td className="py-[7px] text-[13px] text-green-700">Already Paid</td><td className="py-[7px] text-right font-mono-data text-[13px] text-green-700">− {rs(voucher.paidAmount)}</td></tr>
                )}
              </tbody>
            </table>

            <div className="mt-md flex items-center justify-between rounded-xl bg-gradient-to-r from-[#0d1a33] to-[#0058be] px-lg py-md text-white">
              <span className="text-[13px] font-semibold uppercase tracking-wide text-white/80">Amount Payable</span>
              <span className="font-mono-data text-[24px] font-bold">{rs(remaining > 0 ? remaining : 0)}</span>
            </div>

            <p className="mt-lg text-[12px] italic text-on-surface-variant">{profile?.voucherFooter || "Please pay before the due date to avoid a late fee."}</p>
            <div className="mt-xl grid grid-cols-2 gap-xl">
              <div className="border-t border-outline-variant pt-xs text-center text-[11px] uppercase tracking-wide text-on-surface-variant">Accounts Signature</div>
              <div className="border-t border-outline-variant pt-xs text-center text-[11px] uppercase tracking-wide text-on-surface-variant">Received By / Bank Stamp</div>
            </div>
          </div>
          <div className="h-[6px] w-full bg-gradient-to-r from-[#0d1a33] via-[#0058be] to-sky-400" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Receipt window ------------------------------ */
function ReceiptWindow({ voucher, payment, profile, onClose }: { voucher: Voucher; payment: Payment; profile: InstituteProfile | null; onClose: () => void }) {
  const name = profile?.name || "Coaching Centre";
  const line2 = [profile?.address, profile?.city].filter(Boolean).join(", ");
  const balance = Math.max(0, voucher.amount - voucher.paidAmount);
  const settled = balance <= 0;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/50 p-lg backdrop-blur-sm print:static print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="w-full max-w-[540px]">
        <div className="mb-md flex items-center justify-end gap-sm no-print">
          <button onClick={() => window.print()} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">print</span> Print Receipt
          </button>
          <button onClick={onClose} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">Close</button>
        </div>

        <div className="print-area rounded-md border border-neutral-300 bg-white p-xl text-black">
          {/* header */}
          <div className="border-b-2 border-black pb-md text-center">
            <p className="text-[18px] font-bold">{name}</p>
            {line2 ? <p className="text-[12px] text-neutral-600">{line2}</p> : null}
            {profile?.phone ? <p className="text-[12px] text-neutral-600">Tel: {profile.phone}</p> : null}
            <p className="mt-sm text-[13px] font-semibold uppercase tracking-[0.2em]">Payment Receipt</p>
          </div>

          <div className="mt-md flex justify-between text-[12px] text-neutral-600">
            <span>Receipt #: <span className="font-mono-data text-black">RCT-{String(payment.id).padStart(5, "0")}</span></span>
            <span>Date: <span className="text-black">{fmtDate(payment.paidAt)}</span></span>
          </div>

          <div className="mt-md space-y-[7px]">
            <div className="flex justify-between"><span className="text-[13px] text-neutral-600">Voucher</span><span className="font-mono-data text-[13px] text-black">{voucher.voucherNo}</span></div>
            <div className="flex justify-between"><span className="text-[13px] text-neutral-600">Student</span><span className="text-[13px] font-medium text-black">{voucher.studentName} ({voucher.studentRegistryId})</span></div>
            <div className="flex justify-between"><span className="text-[13px] text-neutral-600">Payment Method</span><span className="text-[13px] text-black">{payment.method || "—"}</span></div>
            {payment.reference && <div className="flex justify-between"><span className="text-[13px] text-neutral-600">Reference</span><span className="font-mono-data text-[13px] text-black">{payment.reference}</span></div>}
            <div className="flex justify-between"><span className="text-[13px] text-neutral-600">Received By (Accounts)</span><span className="text-[13px] font-semibold text-black">{payment.receivedBy || "—"}</span></div>
          </div>

          <div className="mt-md flex justify-between border-y-2 border-black py-sm">
            <span className="text-[14px] font-bold text-black">Amount Received</span>
            <span className="font-mono-data text-[16px] font-bold text-black">{rs(payment.amount)}</span>
          </div>

          <div className="mt-sm flex justify-between text-[12px] text-neutral-600">
            <span>Paid: {rs(voucher.paidAmount)} / {rs(voucher.amount)}</span>
            <span>Balance: {rs(balance)}{settled ? " (paid in full)" : ""}</span>
          </div>

          <div className="my-md border-t border-dashed border-neutral-400" />
          <p className="text-center text-[12px] text-neutral-600">Thank you for your payment.</p>
          <div className="mx-auto mt-lg w-1/2 border-t border-black pt-xs text-center text-[11px] text-neutral-600">Authorised Signature</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Create voucher ------------------------------ */
function CreateVoucher({ students, fees, onClose, onSaved }: {
  students: Student[]; fees: FeeComponent[]; onClose: () => void; onSaved: () => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [feeId, setFeeId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [generateDate, setGenerateDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onFee(e: React.ChangeEvent<HTMLSelectElement>) {
    setFeeId(e.target.value);
    const f = fees.find((x) => String(x.id) === e.target.value);
    if (f) { setAmount(f.amount); setDescription(f.name); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) { setErr("Select a student"); return; }
    if (amount <= 0) { setErr("Amount must be greater than 0"); return; }
    setSaving(true); setErr(null);
    try {
      await vouchersApi.create({
        studentId: Number(studentId),
        feeComponentId: feeId ? Number(feeId) : null,
        description: description || null,
        amount,
        generateDate: generateDate || null,
        dueDate: dueDate || null,
        expiryDate: expiryDate || null,
      });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">New Voucher</h2>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        <Field label="Student" required>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
            <option value="">Select a student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.registryId})</option>)}
          </Select>
        </Field>
        <Field label="Fee component" hint="Optional — prefills amount and description">
          <Select value={feeId} onChange={onFee}>
            <option value="">Custom / none</option>
            {fees.map((f) => <option key={f.id} value={f.id}>{f.name} — {rs(f.amount)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Amount (Rs)" required><NumberInput value={amount} onValueChange={setAmount} required /></Field>
          <Field label="Generate date"><TextInput type="date" value={generateDate} onChange={(e) => setGenerateDate(e.target.value)} /></Field>
          <Field label="Due date"><TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Expiry date"><TextInput type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
        </div>
        <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Monthly Tuition - August" /></Field>
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Creating…" : "Create Voucher"}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Record payment ------------------------------ */
function RecordPayment({ voucher, methods, onClose, onSaved }: {
  voucher: Voucher; methods: string[]; onClose: () => void; onSaved: (voucher: Voucher, payment?: Payment) => void;
}) {
  const remaining = voucher.amount - voucher.paidAmount;
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState(methods[0] || "Cash");
  const [reference, setReference] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0) { setErr("Enter a valid amount"); return; }
    if (!receivedBy.trim()) { setErr("Enter who received the payment (accounts person)"); return; }
    setSaving(true); setErr(null);
    try {
      const updated = await vouchersApi.recordPayment(voucher.id, { amount, method, reference: reference || undefined, receivedBy: receivedBy.trim() });
      onSaved(updated, updated.payment);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[480px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <h2 className="font-headline-md text-headline-md font-semibold text-primary">Record Payment</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {voucher.voucherNo} · {voucher.studentName} · remaining <span className="font-mono-data text-error">{rs(remaining)}</span>
        </p>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}
        <Field label="Amount Received (Rs)" required><NumberInput value={amount} onValueChange={setAmount} max={remaining} required /></Field>
        <Field label="Payment Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {(methods.length ? methods : ["Cash"]).map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Received By (Accounts Person)" required>
          <TextInput value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="e.g. Mr. Bilal (Accounts)" required />
        </Field>
        <Field label="Transaction / Reference ID">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. JC-9921 or Challan #" />
        </Field>
        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Recording…" : "Confirm & Record"}</button>
        </div>
      </form>
    </div>
  );
}
