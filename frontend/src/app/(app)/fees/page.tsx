"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { feesApi, coursesApi, type FeeComponent, type Course } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

const CATEGORIES = ["Tuition", "Admission", "Facility", "Exam", "Service", "Other"];
const FREQUENCIES = ["One-time", "Monthly", "Quarterly", "Annual"];

type FeeForm = { name: string; category: string; frequency: string; amount: string; status: string; description: string };
const EMPTY: FeeForm = { name: "", category: "Tuition", frequency: "Monthly", amount: "0", status: "active", description: "" };

export default function FeesPage() {
  const [fees, setFees] = useState<FeeComponent[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { mode: "new" | "edit"; id?: number }>(null);
  const [form, setForm] = useState<FeeForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setFees(await feesApi.list()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { coursesApi.list().then(setCourses).catch(() => setCourses([])); }, []);

  function openNew() { setForm(EMPTY); setModal({ mode: "new" }); }
  function openEdit(f: FeeComponent) {
    setForm({ name: f.name, category: f.category || "Other", frequency: f.frequency || "Monthly", amount: String(f.amount), status: f.status, description: f.description || "" });
    setModal({ mode: "edit", id: f.id });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name, category: form.category, frequency: form.frequency, amount: Number(form.amount) || 0, status: form.status, description: form.description || null };
      if (modal?.mode === "edit" && modal.id) await feesApi.update(modal.id, payload);
      else await feesApi.create(payload);
      setModal(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function del(f: FeeComponent) {
    if (!confirm(`Delete "${f.name}"?`)) return;
    try { await feesApi.remove(f.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
  }

  const setF = (k: keyof FeeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1200px] space-y-lg">
        <PageHeader
          title="Fee Definition"
          subtitle="Define reusable fee components for vouchers."
          icon="payments"
          actions={
            <button onClick={openNew} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> New Fee
            </button>
          }
        />

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">Fee Name</th>
                <th className="px-md py-sm">Category</th>
                <th className="px-md py-sm">Frequency</th>
                <th className="px-md py-sm">Amount</th>
                <th className="px-md py-sm">Status</th>
                <th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-error font-body-md">{error} — is the backend running on :4000?</td></tr>
              ) : fees.length === 0 ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">No fee components yet. Click “New Fee”.</td></tr>
              ) : fees.map((f) => (
                <tr key={f.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface">{f.name}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{f.category || "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{f.frequency || "—"}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data">{rs(f.amount)}</td>
                  <td className="px-md py-sm">
                    <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${f.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{f.status}</span>
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex items-center justify-end gap-xs">
                      <button onClick={() => openEdit(f)} className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high" title="Edit"><span className="material-symbols-outlined text-[20px]">edit</span></button>
                      <button onClick={() => del(f)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete"><span className="material-symbols-outlined text-[20px]">delete</span></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Course fee structure — admission / monthly / exam defined per course */}
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
            <div>
              <h2 className="font-headline-md text-headline-md font-semibold text-primary">Course Fee Structure</h2>
              <p className="font-label-md text-label-md text-on-surface-variant">Admission, monthly, and exam fees defined on each course.</p>
            </div>
            <Link href="/courses" className="font-label-md text-label-md text-secondary hover:underline">Edit in Courses →</Link>
          </div>
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">Course</th>
                <th className="px-md py-sm">Admission</th>
                <th className="px-md py-sm">Monthly</th>
                <th className="px-md py-sm">Exam</th>
                <th className="px-md py-sm">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {courses.length === 0 ? (
                <tr><td colSpan={5} className="px-md py-lg text-center text-on-surface-variant font-body-md">No courses yet. Add courses (with fees) in the Courses module.</td></tr>
              ) : courses.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface">{c.name}<div className="font-label-md text-label-md text-on-surface-variant">{c.code || ""}</div></td>
                  <td className="px-md py-sm font-mono-data text-mono-data">{rs(c.admissionFee)}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data">{rs(c.monthlyFee)}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data">{rs(c.examFee)}</td>
                  <td className="px-md py-sm">
                    <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${c.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant">
            Note: monthly fees are billed per <strong>batch</strong> — a course’s batches can each set their own monthly fee, which drives voucher generation.
          </p>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setModal(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">{modal.mode === "edit" ? "Edit Fee" : "New Fee"}</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Fee Name *</span><input className={inputCls} value={form.name} onChange={setF("name")} required /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Category</span><select className={inputCls} value={form.category} onChange={setF("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Frequency</span><select className={inputCls} value={form.frequency} onChange={setF("frequency")}>{FREQUENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Amount (Rs)</span><input type="number" min={0} inputMode="decimal" className={inputCls} value={form.amount} onChange={setF("amount")} required /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Status</span><select className={inputCls} value={form.status} onChange={setF("status")}>{["active", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Description</span><textarea className={inputCls} rows={2} value={form.description} onChange={setF("description")} /></label>
            </div>
            <div className="flex justify-end gap-sm pt-sm">
              <button type="button" onClick={() => setModal(null)} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
