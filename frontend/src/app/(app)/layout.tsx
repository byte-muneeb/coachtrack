"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getToken, getUser } from "@/lib/api";
import { canAccess } from "@/lib/permissions";

// Wraps every desktop management page in the shared sidebar + topbar, behind an
// auth guard (redirects to /login when signed out) and a role guard (redirects
// to /dashboard when the current role may not open this module).
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    const role = getUser()?.role;
    if (!canAccess(role, pathname)) { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router, pathname]);

  if (!ok) {
    return <div className="flex min-h-screen items-center justify-center bg-background font-body-md text-on-surface-variant">Loading…</div>;
  }
  return <AppShell>{children}</AppShell>;
}
