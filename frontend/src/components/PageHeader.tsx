import React from "react";

/**
 * Standard page header used across every page for a consistent,
 * professional layout: title + subtitle on the left, actions on the right,
 * a hairline divider beneath. Keeps spacing identical app-wide.
 */
export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-md border-b border-outline-variant pb-md">
      <div className="flex items-start gap-md">
        {icon && (
          <span className="mt-[2px] flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-on-primary-fixed">
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
          </span>
        )}
        <div>
          <h1 className="font-display text-[24px] font-bold leading-tight tracking-tight text-primary">{title}</h1>
          {subtitle && <p className="mt-[2px] font-body-md text-body-md text-on-surface-variant">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-sm">{actions}</div>}
    </div>
  );
}
