import React from "react";

const TONES: Record<string, { badge: string; bar: string }> = {
  green: { badge: "bg-green-100 text-green-700", bar: "from-green-400 to-emerald-500" },
  red: { badge: "bg-error-container text-on-error-container", bar: "from-rose-400 to-error" },
  blue: { badge: "bg-primary-fixed text-on-primary-fixed", bar: "from-secondary to-[#4a93f5]" },
  amber: { badge: "bg-amber-100 text-amber-700", bar: "from-amber-400 to-orange-500" },
  secondary: { badge: "bg-secondary-fixed text-on-secondary-fixed", bar: "from-secondary to-sky-400" },
  neutral: { badge: "bg-surface-container-high text-on-surface-variant", bar: "from-slate-300 to-slate-400" },
};

export default function StatCard({
  label,
  value,
  icon,
  tone = "blue",
  valueClass = "text-primary",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  icon: string;
  tone?: keyof typeof TONES | string;
  valueClass?: string;
  sub?: React.ReactNode;
}) {
  const t = TONES[tone] || TONES.blue;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-card transition-all duration-200 hover:-translate-y-[2px] hover:shadow-card-hover">
      {/* gradient accent bar */}
      <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${t.bar}`} />
      <div className="flex items-start justify-between gap-sm">
        <p className="font-label-md text-label-md font-semibold uppercase tracking-[0.08em] text-on-surface-variant">{label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/[0.04] transition-transform duration-200 group-hover:scale-105 ${t.badge}`}>
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        </span>
      </div>
      <p className={`mt-md font-display text-[30px] font-bold leading-none tracking-tight ${valueClass}`}>{value}</p>
      {sub && <p className="mt-sm font-label-md text-label-md text-on-surface-variant">{sub}</p>}
    </div>
  );
}
