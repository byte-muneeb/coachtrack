"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getToken } from "@/lib/api";

// Wraps every desktop management page in the shared sidebar + topbar,
// behind an auth guard (redirects to /login when no token is present).
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setOk(true);
  }, [router]);

  if (!ok) {
    return <div className="flex min-h-screen items-center justify-center bg-background font-body-md text-on-surface-variant">Loading…</div>;
  }
  return <AppShell>{children}</AppShell>;
}
