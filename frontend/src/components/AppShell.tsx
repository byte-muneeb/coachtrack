"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV } from "@/lib/nav";
import { statsApi, setToken } from "@/lib/api";

const ADMIN_ONLY = new Set(["/settings", "/users", "/audit"]);
function initials(name: string) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

type Notif = { id: number; title: string; sub: string; href: string };

/** Small dropdown that closes on outside-click / Escape. */
function Dropdown({
  open,
  onClose,
  align = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "right" | "left";
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <button aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div
        className={`absolute top-[calc(100%+8px)] z-50 w-[320px] origin-top rounded-xl border border-outline-variant bg-surface-container-lowest shadow-[var(--shadow-pop)] ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </div>
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [menu, setMenu] = useState<null | "notif" | "help" | "profile">(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [user, setUser] = useState<{ username: string; fullName: string | null; role: string } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const raw = window.localStorage.getItem("ct_user"); if (raw) setUser(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);

  function signOut() {
    setToken(null);
    try { window.localStorage.removeItem("ct_user"); } catch { /* ignore */ }
    window.location.href = "/login";
  }

  const role = user?.role || "admin";
  const displayName = user?.fullName || user?.username || "User";
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const nav = NAV
    .map((g) => ({ ...g, items: g.items.filter((it) => role === "admin" || !ADMIN_ONLY.has(it.href)) }))
    .filter((g) => g.items.length > 0);

  // Close any menu when route changes.
  useEffect(() => setMenu(null), [pathname]);

  // Escape closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load real notifications from overdue/outstanding data.
  useEffect(() => {
    statsApi
      .reports()
      .then((r) => {
        const list: Notif[] = (r.defaulters || []).slice(0, 6).map((d) => ({
          id: d.id,
          title: `${d.fullName} — ${rs(d.outstanding)} outstanding`,
          sub: d.overdueCount > 0 ? `${d.overdueCount} overdue voucher${d.overdueCount === 1 ? "" : "s"}` : "Fee pending",
          href: `/students/${d.id}`,
        }));
        setNotifs(list);
      })
      .catch(() => setNotifs([]))
      .finally(() => setNotifLoaded(true));
  }, []);

  const notifCount = notifs.length;

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* ---------- Sidebar ---------- */}
      <aside className="fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col border-r border-white/5 bg-gradient-to-b from-[#0d1a33] to-[#081120] text-on-primary">
        <Link href="/dashboard" className="flex items-center gap-sm px-lg py-md">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-white shadow-[0_4px_12px_rgba(33,112,228,0.35)]">
            <span className="material-symbols-outlined text-[22px]">school</span>
          </span>
          <div className="leading-tight">
            <p className="font-headline-md text-[17px] font-semibold text-white">CoachTrack Pro</p>
            <p className="text-[11px] font-medium tracking-wide text-white/45">Management Suite</p>
          </div>
        </Link>

        <div className="mx-lg mb-sm h-px bg-white/8" />

        <nav className="no-scrollbar flex-1 space-y-lg overflow-y-auto px-md pb-md">
          {nav.map((group) => (
            <div key={group.heading} className="space-y-[3px]">
              <p className="px-sm pb-xs text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {group.heading}
              </p>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={[
                      "group relative flex items-center gap-sm rounded-lg px-sm py-[9px] text-[14px] transition-colors",
                      active
                        ? "bg-white/10 font-semibold text-white"
                        : "font-medium text-[#9aa6bd] hover:bg-white/5 hover:text-white",
                    ].join(" ")}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-secondary-fixed-dim" />
                    )}
                    <span
                      className={[
                        "material-symbols-outlined text-[20px] transition-colors",
                        active ? "text-secondary-fixed-dim" : "text-[#8590a6] group-hover:text-white",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/8 p-md">
          <Link
            href="/settings"
            className="flex items-center gap-sm rounded-xl bg-white/5 px-sm py-sm ring-1 ring-white/5 transition-colors hover:bg-white/10"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-secondary to-[#0a49a0] text-[13px] font-semibold text-white">
              {initials(displayName)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold text-white">{displayName}</p>
              <p className="truncate text-[11px] text-white/45">{roleLabel}</p>
            </div>
            <span className="material-symbols-outlined text-[20px] text-white/40">settings</span>
          </Link>
        </div>
      </aside>

      {/* ---------- Topbar ---------- */}
      <header className="fixed right-0 top-0 z-40 flex h-16 w-[calc(100%-280px)] items-center justify-between border-b border-outline-variant bg-surface/85 px-margin-desktop backdrop-blur-md shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
        <div className="min-w-0">
          <p className="truncate font-body-md text-body-md font-semibold text-on-surface">Head Office</p>
          <p className="truncate font-label-md text-label-md text-on-surface-variant">Coaching Centre Management</p>
        </div>

        <div ref={barRef} className="relative flex items-center gap-xs">
          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setMenu(menu === "notif" ? null : "notif")}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined">notifications</span>
              {notifCount > 0 && (
                <span className="absolute right-[6px] top-[6px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-error px-[3px] text-[9px] font-bold text-white ring-2 ring-surface">
                  {notifCount}
                </span>
              )}
            </button>
            <Dropdown open={menu === "notif"} onClose={() => setMenu(null)}>
              <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
                <p className="font-body-md text-body-md font-semibold text-on-surface">Notifications</p>
                {notifCount > 0 && (
                  <span className="rounded-full bg-error-container px-sm py-[1px] font-label-md text-label-md text-on-error-container">
                    {notifCount} pending
                  </span>
                )}
              </div>
              <div className="max-h-[320px] overflow-y-auto py-xs">
                {!notifLoaded ? (
                  <p className="px-md py-md font-body-md text-body-md text-on-surface-variant">Loading…</p>
                ) : notifCount === 0 ? (
                  <div className="flex flex-col items-center gap-xs px-md py-lg text-center">
                    <span className="material-symbols-outlined text-[32px] text-green-600">check_circle</span>
                    <p className="font-body-md text-body-md text-on-surface-variant">All caught up — no pending dues.</p>
                  </div>
                ) : (
                  notifs.map((n) => (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => setMenu(null)}
                      className="flex items-start gap-sm px-md py-sm hover:bg-surface-container-low"
                    >
                      <span className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
                        <span className="material-symbols-outlined text-[18px]">error</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-body-md text-body-md text-on-surface">{n.title}</span>
                        <span className="block truncate font-label-md text-label-md text-on-surface-variant">{n.sub}</span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
              <Link
                href="/reports"
                onClick={() => setMenu(null)}
                className="block border-t border-outline-variant px-md py-sm text-center font-label-md text-label-md text-secondary hover:bg-surface-container-low"
              >
                View all in Reports →
              </Link>
            </Dropdown>
          </div>

          {/* Help */}
          <div className="relative">
            <button
              onClick={() => setMenu(menu === "help" ? null : "help")}
              className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
              aria-label="Help"
            >
              <span className="material-symbols-outlined">help_outline</span>
            </button>
            <Dropdown open={menu === "help"} onClose={() => setMenu(null)}>
              <div className="border-b border-outline-variant px-md py-sm">
                <p className="font-body-md text-body-md font-semibold text-on-surface">Help &amp; Support</p>
              </div>
              <div className="py-xs">
                {[
                  { icon: "menu_book", label: "Quick start guide", sub: "How to use CoachTrack Pro" },
                  { icon: "contact_support", label: "Contact support", sub: "support@coachtrack.pk" },
                  { icon: "keyboard", label: "Keyboard shortcuts", sub: "Speed up common actions" },
                  { icon: "info", label: "About", sub: "CoachTrack Pro · v1.0" },
                ].map((h) => (
                  <div key={h.label} className="flex items-start gap-sm px-md py-sm hover:bg-surface-container-low">
                    <span className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed">
                      <span className="material-symbols-outlined text-[18px]">{h.icon}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-body-md text-body-md text-on-surface">{h.label}</span>
                      <span className="block truncate font-label-md text-label-md text-on-surface-variant">{h.sub}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Dropdown>
          </div>

          <div className="mx-xs h-6 w-px bg-outline-variant" />

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setMenu(menu === "profile" ? null : "profile")}
              className="flex items-center gap-xs rounded-full py-[3px] pl-[3px] pr-sm hover:bg-surface-container"
              aria-label="Account"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-secondary to-[#0a49a0] text-[13px] font-semibold text-white">
                {initials(displayName)}
              </span>
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">arrow_drop_down</span>
            </button>
            <Dropdown open={menu === "profile"} onClose={() => setMenu(null)}>
              <div className="flex items-center gap-sm border-b border-outline-variant px-md py-md">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-secondary to-[#0a49a0] text-[14px] font-semibold text-white">
                  {initials(displayName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-body-md text-body-md font-semibold text-on-surface">{displayName}</p>
                  <p className="truncate font-label-md text-label-md text-on-surface-variant">{roleLabel}</p>
                </div>
              </div>
              <div className="py-xs">
                <Link href="/settings" onClick={() => setMenu(null)} className="flex items-center gap-sm px-md py-sm font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">person</span> Institute profile
                </Link>
                <Link href="/settings" onClick={() => setMenu(null)} className="flex items-center gap-sm px-md py-sm font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">settings</span> Settings
                </Link>
                <Link href="/branches" onClick={() => setMenu(null)} className="flex items-center gap-sm px-md py-sm font-body-md text-body-md text-on-surface hover:bg-surface-container-low">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">apartment</span> Switch branch
                </Link>
              </div>
              <div className="border-t border-outline-variant py-xs">
                <button
                  onClick={signOut}
                  className="flex w-full items-center gap-sm px-md py-sm font-body-md text-body-md text-error hover:bg-error-container"
                >
                  <span className="material-symbols-outlined text-[20px]">logout</span> Sign out
                </button>
              </div>
            </Dropdown>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
