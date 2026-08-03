"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { inquiriesApi, type Inquiry } from "@/lib/api";
import StatCard from "@/components/StatCard";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";

const STAGES: { key: string; label: string }[] = [
  { key: "new", label: "New Inquiry" },
  { key: "contacted", label: "Contacted" },
  { key: "trial", label: "Trial / Demo" },
  { key: "enrolled", label: "Enrolled" },
  { key: "lost", label: "Lost" },
];
const SOURCES = ["Walk-in", "Facebook", "Referral", "Website", "Other"];

type IForm = { name: string; phone: string; interestedCourse: string; source: string; trialDate: string; notes: string };
const EMPTY: IForm = { name: "", phone: "", interestedCourse: "", source: "Walk-in", trialDate: "", notes: "" };

export default function AdmissionsPage() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<IForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await inquiriesApi.list()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    const total = items.length;
    const trials = items.filter((i) => i.stage === "trial").length;
    const enrolled = items.filter((i) => i.stage === "enrolled").length;
    const conv = total > 0 ? Math.round((enrolled / total) * 1000) / 10 : 0;
    return { total, trials, enrolled, conv };
  }, [items]);

  async function addInquiry(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await inquiriesApi.create({ name: form.name, phone: form.phone || null, interestedCourse: form.interestedCourse || null, source: form.source, trialDate: form.trialDate || null, notes: form.notes || null });
      setModal(false); setForm(EMPTY); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function move(i: Inquiry, stage: string) {
    try { await inquiriesApi.update(i.id, { stage }); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function convert(i: Inquiry) {
    if (!confirm(`Convert ${i.name} into an enrolled student?`)) return;
    try { const r = await inquiriesApi.convert(i.id); await load(); alert(`Enrolled as ${r.student.registryId}`); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function del(i: Inquiry) {
    if (!confirm(`Delete inquiry for ${i.name}?`)) return;
    try { await inquiriesApi.remove(i.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  const setF = (k: keyof IForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1240px] space-y-lg">
        <PageHeader
          title="Inquiries"
          subtitle="Track leads from first inquiry to enrollment."
          icon="how_to_reg"
          actions={
            <button onClick={() => setModal(true)} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> New Inquiry
            </button>
          }
        />

        <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
          <StatCard label="Total Leads" value={metrics.total} icon="groups" tone="blue" />
          <StatCard label="Trials Scheduled" value={metrics.trials} icon="event_available" tone="amber" valueClass="text-amber-600" />
          <StatCard label="Conversion Rate" value={`${metrics.conv}%`} icon="trending_up" tone="green" valueClass="text-green-700" />
        </div>

        <div className="flex flex-wrap items-center gap-xs">
          {[{ key: "all", label: "All" }, ...STAGES].map((s) => (
            <button
              key={s.key}
              onClick={() => setStageFilter(s.key)}
              className={`rounded-full px-md py-[4px] font-label-md text-label-md ${
                stageFilter === s.key
                  ? "bg-secondary text-on-secondary"
                  : "bg-surface-container-high text-on-surface-variant hover:opacity-90"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
                <th className="px-md py-sm font-medium">Prospect</th>
                <th className="px-md py-sm font-medium">Phone</th>
                <th className="px-md py-sm font-medium">Interested Course</th>
                <th className="px-md py-sm font-medium">Source</th>
                <th className="px-md py-sm font-medium">Stage</th>
                <th className="px-md py-sm text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-md py-lg text-center font-body-md text-body-md text-on-surface-variant">Loading…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-md py-lg text-center font-body-md text-body-md text-error">{error} — is the backend running on :4000?</td>
                </tr>
              ) : (() => {
                const rows = items.filter((i) => stageFilter === "all" || i.stage === stageFilter);
                if (rows.length === 0) {
                  return (
                    <tr>
                      <td colSpan={6} className="px-md py-lg text-center font-body-md text-body-md text-on-surface-variant">No inquiries yet.</td>
                    </tr>
                  );
                }
                return rows.map((i) => (
                  <tr key={i.id} className="border-t border-outline-variant">
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface">{i.name}</td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{i.phone || "—"}</td>
                    <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{i.interestedCourse || "—"}</td>
                    <td className="px-md py-sm">
                      {i.source ? (
                        <span className="inline-block rounded-full bg-primary-fixed px-sm py-[1px] font-label-md text-label-md text-on-primary-fixed">{i.source}</span>
                      ) : (
                        <span className="font-body-md text-body-md text-on-surface-variant">—</span>
                      )}
                    </td>
                    <td className="px-md py-sm">
                      <select value={i.stage} onChange={(e) => move(i, e.target.value)} className={inputCls + " w-auto py-[4px]"}>
                        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-sm">
                        {i.stage !== "enrolled" && !i.convertedStudentId && (
                          <button onClick={() => convert(i)} title="Convert to student" className="rounded-md bg-secondary px-sm py-[3px] font-label-md text-label-md text-on-secondary hover:opacity-90">Enroll</button>
                        )}
                        <button onClick={() => del(i)} title="Delete" className="text-error hover:opacity-80">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setModal(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={addInquiry} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">New Inquiry</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Prospect Name *</span><input className={inputCls} value={form.name} onChange={setF("name")} required /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Phone</span><input type="tel" className={inputCls} value={form.phone} onChange={setF("phone")} placeholder="03xx-xxxxxxx" /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Source</span><select className={inputCls} value={form.source} onChange={setF("source")}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Interested Course</span><input className={inputCls} value={form.interestedCourse} onChange={setF("interestedCourse")} placeholder="MDCAT Prep" /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Trial/Demo Date</span><input type="date" className={inputCls} value={form.trialDate} onChange={setF("trialDate")} /></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Notes</span><input className={inputCls} value={form.notes} onChange={setF("notes")} /></label>
            </div>
            <div className="flex justify-end gap-sm pt-sm">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Add Inquiry"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
