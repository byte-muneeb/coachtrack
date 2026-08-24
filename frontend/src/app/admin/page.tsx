"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { entitiesApi, getUser, setToken, setUser, signOut, type Entity, type AppUser } from "@/lib/api";

export default function SuperAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<AppUser | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ name: "", adminUsername: "", adminPassword: "", contactEmail: "" });

  const load = useCallback(async () => {
    try { setEntities(await entitiesApi.list()); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace("/login"); return; }
    if (u.role !== "super_admin") { router.replace("/dashboard"); return; }
    setMe(u);
    setReady(true);
    load();
  }, [router, load]);

  async function createEntity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.adminUsername.trim() || form.adminPassword.length < 6) {
      setError("Name, admin username, and a 6+ char password are required.");
      return;
    }
    setBusy(true);
    try {
      await entitiesApi.create({
        name: form.name.trim(),
        adminUsername: form.adminUsername.trim(),
        adminPassword: form.adminPassword,
        contactEmail: form.contactEmail.trim() || undefined,
      });
      setForm({ name: "", adminUsername: "", adminPassword: "", contactEmail: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to create entity"); }
    finally { setBusy(false); }
  }

  async function impersonate(ent: Entity) {
    setError(null);
    try {
      const { token } = await entitiesApi.impersonate(ent.id);
      setToken(token);
      // Build an entity_admin session that remembers the super admin (impersonatorId).
      setUser({
        id: me?.id ?? 0, username: me?.username ?? "superadmin", fullName: me?.fullName ?? null,
        role: "entity_admin", entityId: ent.id, impersonatorId: me?.id, allBranches: true, branchIds: [],
      });
      router.replace("/dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to impersonate"); }
  }

  async function toggleStatus(ent: Entity) {
    try {
      await entitiesApi.update(ent.id, { status: ent.status === "active" ? "suspended" : "active" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update"); }
  }

  async function remove(ent: Entity) {
    try { await entitiesApi.remove(ent.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to delete"); }
  }

  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-[#0d1a33] text-white/60">Loading…</main>;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0d1a33] to-[#081120] p-lg text-white">
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-lg flex items-center justify-between">
          <div>
            <p className="font-display text-[24px] font-bold">CoachTrack — Platform Admin</p>
            <p className="text-[13px] text-white/50">Signed in as {me?.username} (super admin)</p>
          </div>
          <button onClick={signOut} className="rounded-lg bg-white/10 px-md py-sm text-[13px] font-semibold hover:bg-white/20">Sign out</button>
        </header>

        {error && <div className="mb-md rounded-lg border border-red-400/40 bg-red-500/10 px-md py-sm text-[13px] text-red-200">{error}</div>}

        <section className="mb-xl rounded-2xl bg-white/5 p-lg ring-1 ring-white/10">
          <h2 className="mb-md text-[16px] font-semibold">Create a new institute (entity)</h2>
          <form onSubmit={createEntity} className="grid grid-cols-1 gap-md md:grid-cols-4">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Institute name"
              className="rounded-lg bg-white/10 px-md py-sm text-[14px] outline-none placeholder:text-white/40" />
            <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Contact email (optional)"
              className="rounded-lg bg-white/10 px-md py-sm text-[14px] outline-none placeholder:text-white/40" />
            <input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} placeholder="Admin username"
              className="rounded-lg bg-white/10 px-md py-sm text-[14px] outline-none placeholder:text-white/40" />
            <input value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="Admin password (6+)" type="password"
              className="rounded-lg bg-white/10 px-md py-sm text-[14px] outline-none placeholder:text-white/40" />
            <button disabled={busy} className="rounded-lg bg-secondary px-md py-sm text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60 md:col-span-1">
              {busy ? "Creating…" : "Create institute"}
            </button>
          </form>
          <p className="mt-sm text-[12px] text-white/40">Creates the institute, its first entity admin, and a &quot;Main Branch&quot;.</p>
        </section>

        <section className="rounded-2xl bg-white/5 p-lg ring-1 ring-white/10">
          <h2 className="mb-md text-[16px] font-semibold">Institutes ({entities.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-white/50">
                <tr className="border-b border-white/10">
                  <th className="py-sm pr-md">Name</th><th className="pr-md">Slug</th><th className="pr-md">Users</th>
                  <th className="pr-md">Students</th><th className="pr-md">Status</th><th className="pr-md">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((ent) => (
                  <tr key={ent.id} className="border-b border-white/5">
                    <td className="py-sm pr-md font-semibold">{ent.name}</td>
                    <td className="pr-md text-white/60">{ent.slug}</td>
                    <td className="pr-md">{ent.userCount ?? 0}</td>
                    <td className="pr-md">{ent.studentCount ?? 0}</td>
                    <td className="pr-md">
                      <span className={ent.status === "active" ? "text-green-400" : "text-amber-400"}>{ent.status}</span>
                    </td>
                    <td className="flex flex-wrap gap-xs py-sm">
                      <button onClick={() => impersonate(ent)} className="rounded-md bg-secondary/80 px-sm py-[4px] text-[12px] font-semibold hover:bg-secondary">Enter</button>
                      <button onClick={() => toggleStatus(ent)} className="rounded-md bg-white/10 px-sm py-[4px] text-[12px] hover:bg-white/20">
                        {ent.status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button onClick={() => remove(ent)} className="rounded-md bg-red-500/20 px-sm py-[4px] text-[12px] text-red-300 hover:bg-red-500/30">Delete</button>
                    </td>
                  </tr>
                ))}
                {entities.length === 0 && (
                  <tr><td colSpan={6} className="py-lg text-center text-white/40">No institutes yet — create one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
