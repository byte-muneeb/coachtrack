"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await authApi.login(username.trim(), password);
      setToken(token);
      if (typeof window !== "undefined") window.localStorage.setItem("ct_user", JSON.stringify(user));
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0d1a33] to-[#081120] p-lg">
      <div className="w-full max-w-[400px]">
        <div className="mb-lg flex flex-col items-center gap-sm text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-white shadow-[0_4px_16px_rgba(33,112,228,0.4)]">
            <span className="material-symbols-outlined text-[30px]">school</span>
          </span>
          <div>
            <p className="font-display text-[22px] font-bold text-white">CoachTrack Pro</p>
            <p className="text-[12px] text-white/50">Management Suite</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-md rounded-2xl bg-white p-xl shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]">
          <h1 className="font-headline-md text-headline-md font-semibold text-primary">Sign in</h1>
          {error && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">Username</span>
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required
              className="w-full rounded-lg border border-outline-variant px-md py-sm font-body-md text-body-md outline-none focus:border-secondary" />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full rounded-lg border border-outline-variant px-md py-sm font-body-md text-body-md outline-none focus:border-secondary" />
          </label>
          <button type="submit" disabled={busy}
            className="w-full rounded-lg bg-secondary px-md py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center font-label-md text-label-md text-on-surface-variant">
            Default admin: <span className="font-mono-data">admin / admin123</span>
          </p>
        </form>
      </div>
    </main>
  );
}
