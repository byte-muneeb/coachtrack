"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { entitiesApi, getUser, setToken, setUser, signOut, type Entity, type AppUser } from "@/lib/api";

function initials(name: string) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    suspended: "bg-amber-50 text-amber-700 ring-amber-600/20",
    deleted: "bg-surface-container text-on-surface-variant ring-outline-variant",
  };
  return (
    <span className={`inline-flex items-center gap-[5px] rounded-full px-sm py-[2px] font-label-md text-label-md font-semibold capitalize ring-1 ring-inset ${map[status] || map.deleted}`}>
      <span className={`h-[6px] w-[6px] rounded-full ${status === "active" ? "bg-emerald-500" : status === "suspended" ? "bg-amber-500" : "bg-outline"}`} />
      {status}
    </span>
  );
}

function StatCard({ icon, label, value, delay }: { icon: string; label: string; value: number | string; delay: number }) {
  return (
    <div style={{ animationDelay: `${delay}ms` }}
      className="admin-rise flex items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-on-primary-fixed">
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </span>
      <div className="min-w-0">
        <p className="font-display text-[26px] font-bold leading-none text-on-surface">{value}</p>
        <p className="mt-[6px] font-label-md text-label-md uppercase tracking-wide text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<AppUser | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setEntities(await entitiesApi.list()); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace("/login"); return; }
    if (u.role !== "super_admin") { router.replace("/dashboard"); return; }
    setMe(u); setReady(true); load();
  }, [router, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entities.filter((e) => e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)) : entities;
  }, [entities, query]);

  const stats = useMemo(() => ({
    total: entities.length,
    active: entities.filter((e) => e.status === "active").length,
    suspended: entities.filter((e) => e.status === "suspended").length,
    students: entities.reduce((a, e) => a + (e.studentCount ?? 0), 0),
  }), [entities]);

  async function impersonate(ent: Entity) {
    setError(null);
    try {
      const { token } = await entitiesApi.impersonate(ent.id);
      setToken(token);
      setUser({
        id: me?.id ?? 0, username: me?.username ?? "superadmin", fullName: me?.fullName ?? null,
        role: "entity_admin", entityId: ent.id, impersonatorId: me?.id, allBranches: true, branchIds: [],
      });
      router.replace("/dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to enter institute"); }
  }
  async function toggleStatus(ent: Entity) {
    try { await entitiesApi.update(ent.id, { status: ent.status === "active" ? "suspended" : "active" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to update"); }
  }
  async function remove(ent: Entity) {
    try { await entitiesApi.remove(ent.id); setConfirmDel(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to delete"); }
  }

  if (!ready) return <main className="grid min-h-screen place-items-center bg-background text-on-surface-variant">Loading…</main>;

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <style>{`@keyframes adminRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.admin-rise{opacity:0;animation:adminRise .5s cubic-bezier(.22,.61,.36,1) forwards}`}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface-container-lowest/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-margin-desktop">
          <div className="flex items-center gap-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-on-primary">
              <span className="material-symbols-outlined text-[22px]">shield_person</span>
            </span>
            <div className="leading-tight">
              <p className="font-headline-md text-[16px] font-semibold text-on-surface">CoachTrack</p>
              <p className="font-label-md text-label-md text-on-surface-variant">Platform Console</p>
            </div>
          </div>
          <div className="flex items-center gap-sm">
            <div className="hidden items-center gap-xs rounded-full bg-surface-container px-md py-[6px] sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-on-secondary">{initials(me?.fullName || me?.username || "SA")}</span>
              <span className="font-label-md text-label-md text-on-surface">{me?.username} · super admin</span>
            </div>
            <button onClick={signOut} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container">
              <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-margin-desktop py-xl">
        <div className="admin-rise flex flex-wrap items-end justify-between gap-md">
          <div>
            <h1 className="font-display text-display font-bold tracking-tight text-on-surface">Institutes</h1>
            <p className="mt-xs font-body-md text-body-md text-on-surface-variant">Create and manage the coaching centers &amp; schools on your platform.</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-xs rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">add_business</span> New institute
          </button>
        </div>

        {error && <div className="admin-rise mt-md rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}

        {/* Stats */}
        <div className="mt-lg grid grid-cols-2 gap-md lg:grid-cols-4">
          <StatCard icon="apartment" label="Institutes" value={stats.total} delay={40} />
          <StatCard icon="check_circle" label="Active" value={stats.active} delay={100} />
          <StatCard icon="pause_circle" label="Suspended" value={stats.suspended} delay={160} />
          <StatCard icon="groups" label="Total students" value={stats.students} delay={220} />
        </div>

        {/* Table card */}
        <section className="admin-rise mt-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest" style={{ animationDelay: "280ms" }}>
          <div className="flex items-center justify-between gap-md border-b border-outline-variant px-lg py-md">
            <p className="font-headline-md text-[16px] font-semibold text-on-surface">All institutes <span className="font-body-md text-on-surface-variant">({filtered.length})</span></p>
            <label className="flex items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-[7px]">
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">search</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or slug"
                className="w-[160px] bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant/70" />
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-sm px-lg py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container text-on-surface-variant">
                <span className="material-symbols-outlined text-[28px]">domain_add</span>
              </span>
              <p className="font-body-lg text-body-lg font-semibold text-on-surface">{entities.length === 0 ? "No institutes yet" : "No matches"}</p>
              <p className="max-w-[320px] font-body-md text-body-md text-on-surface-variant">{entities.length === 0 ? "Create your first coaching center or school to get started." : "Try a different search term."}</p>
              {entities.length === 0 && <button onClick={() => setShowCreate(true)} className="mt-sm rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90">Create institute</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low">
                    {["Institute", "Users", "Students", "Status", ""].map((h, i) => (
                      <th key={i} className="px-lg py-sm font-label-md text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ent) => (
                    <tr key={ent.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                      <td className="px-lg py-md">
                        <div className="flex items-center gap-sm">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-[13px] font-bold text-on-primary-fixed">{initials(ent.name)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-body-md text-body-md font-semibold text-on-surface">{ent.name}</p>
                            <p className="truncate font-mono-data text-mono-data text-on-surface-variant">/{ent.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface">{ent.userCount ?? 0}</td>
                      <td className="px-lg py-md font-body-md text-body-md text-on-surface">{ent.studentCount ?? 0}</td>
                      <td className="px-lg py-md"><StatusPill status={ent.status} /></td>
                      <td className="px-lg py-md">
                        <div className="flex items-center justify-end gap-xs">
                          <button onClick={() => impersonate(ent)} title="Enter this institute"
                            className="flex items-center gap-xs rounded-lg bg-secondary px-md py-[6px] font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90">
                            <span className="material-symbols-outlined text-[16px]">login</span> Enter
                          </button>
                          <button onClick={() => toggleStatus(ent)} title={ent.status === "active" ? "Suspend" : "Activate"}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container">
                            <span className="material-symbols-outlined text-[18px]">{ent.status === "active" ? "pause" : "play_arrow"}</span>
                          </button>
                          {confirmDel === ent.id ? (
                            <button onClick={() => remove(ent)} className="rounded-lg bg-error px-md py-[6px] font-label-md text-label-md font-semibold text-on-error hover:opacity-90">Confirm?</button>
                          ) : (
                            <button onClick={() => setConfirmDel(ent.id)} title="Delete"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-error hover:bg-error-container">
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} onError={setError} />}
    </main>
  );
}

function CreateModal({ onClose, onCreated, onError }: { onClose: () => void; onCreated: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ name: "", contactEmail: "", adminUsername: "", adminPassword: "" });
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocal(null);
    if (!form.name.trim() || !form.adminUsername.trim() || form.adminPassword.length < 6) {
      setLocal("Institute name, admin username, and a 6+ character password are required."); return;
    }
    setBusy(true);
    try {
      await entitiesApi.create({
        name: form.name.trim(), adminUsername: form.adminUsername.trim(), adminPassword: form.adminPassword,
        contactEmail: form.contactEmail.trim() || undefined,
      });
      onCreated();
    } catch (e) { const m = e instanceof Error ? e.message : "Failed to create institute"; setLocal(m); onError(m); }
    finally { setBusy(false); }
  }

  const field = "w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:border-secondary";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-md" onClick={onClose}>
      <div className="admin-rise w-full max-w-[440px] rounded-xl bg-surface-container-lowest p-xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <style>{`@keyframes adminRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.admin-rise{animation:adminRise .28s cubic-bezier(.22,.61,.36,1) forwards}`}</style>
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline-md text-headline-md font-semibold text-on-surface">New institute</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container"><span className="material-symbols-outlined text-[20px]">close</span></button>
        </div>
        <p className="mb-lg font-body-md text-body-md text-on-surface-variant">Creates the institute, its first admin account, and a &quot;Main Branch&quot;.</p>
        <form onSubmit={submit} className="space-y-md">
          <div>
            <label className="mb-xs block font-label-md text-label-md font-medium text-on-surface-variant">Institute name</label>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ali Academy" className={field} />
          </div>
          <div>
            <label className="mb-xs block font-label-md text-label-md font-medium text-on-surface-variant">Contact email <span className="text-on-surface-variant/60">(optional)</span></label>
            <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="admin@institute.pk" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-md">
            <div>
              <label className="mb-xs block font-label-md text-label-md font-medium text-on-surface-variant">Admin username</label>
              <input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} placeholder="ali-admin" className={field} />
            </div>
            <div>
              <label className="mb-xs block font-label-md text-label-md font-medium text-on-surface-variant">Admin password</label>
              <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="min 6 chars" className={field} />
            </div>
          </div>
          {local && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{local}</div>}
          <div className="flex justify-end gap-sm pt-xs">
            <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-lg py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">{busy ? "Creating…" : "Create institute"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
