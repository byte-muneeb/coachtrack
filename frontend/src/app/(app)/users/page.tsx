"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authApi, branchesApi, type AppUser, type Branch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Field, TextInput, Select } from "@/components/form";

const ROLES = [
  { value: "entity_admin", label: "Entity Admin", desc: "Full access to the whole institute (all branches)" },
  { value: "branch_manager", label: "Branch Manager", desc: "Full access within assigned branch(es)" },
  { value: "accountant", label: "Accountant", desc: "Fees, vouchers, payments, expenses, reports" },
  { value: "front_desk", label: "Front Desk", desc: "Students & admissions; can record payments" },
  { value: "teacher", label: "Teacher", desc: "View assigned batches/students (read-mostly)" },
];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label || r.replace(/_/g, " ");
const roleDesc = (r: string) => ROLES.find((x) => x.value === r)?.desc || "";

type NewUser = { username: string; password: string; fullName: string; role: string; branchIds: number[] };
const EMPTY: NewUser = { username: "", password: "", fullName: "", role: "accountant", branchIds: [] };

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewUser>(EMPTY);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [u, b] = await Promise.all([authApi.users(), branchesApi.list()]);
      setUsers(u); setBranches(b);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const needsBranches = form.role !== "entity_admin";

  function toggleBranch(id: number) {
    setForm((p) => ({ ...p, branchIds: p.branchIds.includes(id) ? p.branchIds.filter((x) => x !== id) : [...p.branchIds, id] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    if (!form.username.trim() || form.password.length < 6) { setFormErr("Username and a 6+ character password are required."); return; }
    if (needsBranches && form.branchIds.length === 0) { setFormErr("Assign at least one branch for this role."); return; }
    setSaving(true);
    try {
      await authApi.createUser({
        username: form.username.trim(), password: form.password, fullName: form.fullName.trim() || undefined,
        role: form.role, branchIds: needsBranches ? form.branchIds : undefined,
      });
      setModal(false); setForm(EMPTY); await load();
    } catch (e) { setFormErr(e instanceof Error ? e.message : "Failed to create user"); }
    finally { setSaving(false); }
  }
  async function del(u: AppUser) {
    if (!confirm(`Remove user "${u.username}"?`)) return;
    try { await authApi.removeUser(u.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to remove user"); }
  }

  function branchesLabel(u: AppUser) {
    if (u.role === "entity_admin") return "All branches";
    const ids = u.branchIds ?? [];
    if (!ids.length) return "—";
    return ids.map((id) => branchName.get(id) || `#${id}`).join(", ");
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1000px] space-y-lg">
        <PageHeader
          title="Users & Roles"
          subtitle="Manage who can sign in, their role, and which branches they can access."
          icon="manage_accounts"
          actions={
            <button onClick={() => { setForm(EMPTY); setFormErr(null); setModal(true); }} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">person_add</span> New User
            </button>
          }
        />

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">User</th><th className="px-md py-sm">Username</th>
                <th className="px-md py-sm">Role</th><th className="px-md py-sm">Branches</th>
                <th className="px-md py-sm">Status</th><th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-error font-body-md">{error}</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">No users yet.</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface">{u.fullName || "—"}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{u.username}</td>
                  <td className="px-md py-sm"><span className="rounded-full bg-primary-fixed px-sm py-[2px] font-label-md text-label-md text-on-primary-fixed">{roleLabel(u.role)}</span></td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{branchesLabel(u)}</td>
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
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">New User</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <Field label="Full Name" className="sm:col-span-2"><TextInput value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} /></Field>
              <Field label="Username" required><TextInput value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} required /></Field>
              <Field label="Password" required hint="Minimum 6 characters"><TextInput type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required /></Field>
              <Field label="Role" hint={roleDesc(form.role)} className="sm:col-span-2">
                <Select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
              </Field>
            </div>

            {needsBranches ? (
              <Field label="Assigned branches" hint="This role can only see/act on the branches you tick.">
                <div className="flex flex-wrap gap-xs rounded-lg border border-outline-variant bg-surface p-sm">
                  {branches.length === 0 ? (
                    <span className="px-xs py-[6px] font-body-md text-body-md text-on-surface-variant">No branches yet — add one under Branches first.</span>
                  ) : branches.map((b) => {
                    const on = form.branchIds.includes(b.id);
                    return (
                      <button type="button" key={b.id} onClick={() => toggleBranch(b.id)}
                        className={`flex items-center gap-xs rounded-lg px-md py-[6px] font-label-md text-label-md font-medium ring-1 ring-inset transition-colors ${on ? "bg-secondary text-on-secondary ring-secondary" : "bg-surface-container text-on-surface ring-outline-variant hover:bg-surface-container-high"}`}>
                        <span className="material-symbols-outlined text-[16px]">{on ? "check_circle" : "add_circle"}</span>
                        {b.name}{b.isPrimary ? " (Main)" : ""}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : (
              <div className="rounded-lg bg-surface-container-low px-md py-sm font-body-md text-body-md text-on-surface-variant">
                Entity admins have access to <b>all branches</b> automatically.
              </div>
            )}

            {formErr && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{formErr}</div>}
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
