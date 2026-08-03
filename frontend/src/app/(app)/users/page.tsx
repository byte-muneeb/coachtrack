"use client";

import { useCallback, useEffect, useState } from "react";
import { authApi, type AppUser } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Field, TextInput, Select } from "@/components/form";

const ROLES = ["admin", "accountant", "receptionist"];
const roleDesc: Record<string, string> = {
  admin: "Full access, incl. users & settings",
  accountant: "Fees, vouchers, collections, reports",
  receptionist: "Students & inquiries",
};

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", role: "accountant" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setUsers(await authApi.users()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username.trim() || !form.password) return;
    setSaving(true);
    try {
      await authApi.createUser(form);
      setModal(false); setForm({ username: "", password: "", fullName: "", role: "accountant" });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function del(u: AppUser) {
    if (!confirm(`Remove user "${u.username}"?`)) return;
    try { await authApi.removeUser(u.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[960px] space-y-lg">
        <PageHeader
          title="Users & Roles"
          subtitle="Manage who can sign in and what they can do."
          icon="manage_accounts"
          actions={
            <button onClick={() => setModal(true)} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">person_add</span> New User
            </button>
          }
        />

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr><th className="px-md py-sm">User</th><th className="px-md py-sm">Username</th><th className="px-md py-sm">Role</th><th className="px-md py-sm">Status</th><th className="px-md py-sm text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={5} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-md py-xl text-center text-error font-body-md">{error}</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface">{u.fullName || "—"}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{u.username}</td>
                  <td className="px-md py-sm"><span className="rounded-full bg-primary-fixed px-sm py-[2px] font-label-md text-label-md capitalize text-on-primary-fixed">{u.role}</span></td>
                  <td className="px-md py-sm"><span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${u.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{u.status}</span></td>
                  <td className="px-md py-sm text-right">
                    <button onClick={() => del(u)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Remove"><span className="material-symbols-outlined text-[20px]">delete</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setModal(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-[520px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">New User</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <Field label="Full Name" className="sm:col-span-2"><TextInput value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} /></Field>
              <Field label="Username" required><TextInput value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} required /></Field>
              <Field label="Password" required><TextInput type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required /></Field>
              <Field label="Role" hint={roleDesc[form.role]} className="sm:col-span-2">
                <Select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
                  {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex justify-end gap-sm pt-sm">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Creating…" : "Create User"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
