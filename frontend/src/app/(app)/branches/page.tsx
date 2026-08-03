"use client";

import { useCallback, useEffect, useState } from "react";
import { branchesApi, type Branch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";

type BForm = { name: string; city: string; address: string; phone: string; manager: string; status: string };
const EMPTY: BForm = { name: "", city: "", address: "", phone: "", manager: "", status: "active" };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { mode: "new" | "edit"; id?: number }>(null);
  const [form, setForm] = useState<BForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBranches(await branchesApi.list()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(EMPTY); setModal({ mode: "new" }); }
  function openEdit(b: Branch) {
    setForm({ name: b.name, city: b.city || "", address: b.address || "", phone: b.phone || "", manager: b.manager || "", status: b.status });
    setModal({ mode: "edit", id: b.id });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name, city: form.city || null, address: form.address || null, phone: form.phone || null, manager: form.manager || null, status: form.status };
      if (modal?.mode === "edit" && modal.id) await branchesApi.update(modal.id, payload);
      else await branchesApi.create(payload);
      setModal(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }
  async function del(b: Branch) {
    if (!confirm(`Delete "${b.name}"?`)) return;
    try { await branchesApi.remove(b.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
  }
  const setF = (k: keyof BForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1240px] space-y-lg">
        <PageHeader
          title="Branches"
          subtitle="Manage campuses of your institute."
          icon="apartment"
          actions={
            <button onClick={openNew} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> New Branch
            </button>
          }
        />

        {loading ? (
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        ) : error ? (
          <p className="font-body-md text-error">{error} — is the backend running on :4000?</p>
        ) : branches.length === 0 ? (
          <p className="font-body-md text-on-surface-variant">No branches yet. Click “New Branch”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
            {branches.map((b) => (
              <div key={b.id} className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-sm">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-on-primary-fixed"><span className="material-symbols-outlined">apartment</span></span>
                    <div>
                      <h3 className="font-headline-md text-headline-md font-semibold text-primary">{b.name}</h3>
                      <p className="font-label-md text-label-md text-on-surface-variant">{b.city || "—"}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${b.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{b.status}</span>
                </div>
                <div className="my-md space-y-xs font-body-md text-body-md text-on-surface-variant">
                  <p className="flex items-center gap-xs"><span className="material-symbols-outlined text-[18px]">location_on</span>{b.address || "—"}</p>
                  <p className="flex items-center gap-xs"><span className="material-symbols-outlined text-[18px]">call</span>{b.phone || "—"}</p>
                  <p className="flex items-center gap-xs"><span className="material-symbols-outlined text-[18px]">person</span>{b.manager || "—"}</p>
                </div>
                <div className="mt-auto flex justify-end gap-xs pt-sm">
                  <button onClick={() => openEdit(b)} className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high" title="Edit"><span className="material-symbols-outlined text-[20px]">edit</span></button>
                  <button onClick={() => del(b)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete"><span className="material-symbols-outlined text-[20px]">delete</span></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="font-label-md text-label-md text-on-surface-variant">Note: per-branch consolidated metrics (students/revenue) activate once records are tagged by branch — planned with multi-branch tagging.</p>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setModal(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">{modal.mode === "edit" ? "Edit Branch" : "New Branch"}</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Branch Name *</span><input className={inputCls} value={form.name} onChange={setF("name")} required /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">City</span><input className={inputCls} value={form.city} onChange={setF("city")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Phone</span><input type="tel" className={inputCls} value={form.phone} onChange={setF("phone")} /></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Address</span><input className={inputCls} value={form.address} onChange={setF("address")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Manager</span><input className={inputCls} value={form.manager} onChange={setF("manager")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Status</span><select className={inputCls} value={form.status} onChange={setF("status")}>{["active", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
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
