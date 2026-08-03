"use client";

import React from "react";

/** Shared control styling — one source of truth for every input/select/textarea. */
export const inputCls =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-secondary disabled:opacity-60";

/** Block characters that make a number input non-numeric (e, E, +, -). */
export function numberGuard(e: React.KeyboardEvent<HTMLInputElement>) {
  if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
}
/** Prevent the mouse wheel from silently changing a focused number field. */
export function noWheel(e: React.WheelEvent<HTMLInputElement>) {
  (e.target as HTMLInputElement).blur();
}

/** Label + required marker + inline error/hint wrapper. */
export function Field({
  label,
  required,
  error,
  hint,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-xs ${className}`}>
      <span className="font-label-md text-label-md text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="font-label-md text-label-md text-error">{error}</span>
      ) : hint ? (
        <span className="font-label-md text-label-md text-on-surface-variant/80">{hint}</span>
      ) : null}
    </label>
  );
}

/** Plain text / email / tel input. */
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${inputCls} ${className}`} />;
}

/**
 * Number input that is genuinely type-protected: only digits (and one dot
 * when `decimal`) reach the value, negatives/exponents are blocked, and the
 * scroll wheel can't change it. Emits value via `onValueChange`.
 */
export function NumberInput({
  value,
  onValueChange,
  decimal = false,
  min = 0,
  max,
  className = "",
  ...rest
}: {
  value: number | string;
  onValueChange: (n: number) => void;
  decimal?: boolean;
  min?: number;
  max?: number;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <input
      {...rest}
      type="number"
      inputMode={decimal ? "decimal" : "numeric"}
      step={decimal ? "0.01" : "1"}
      min={min}
      max={max}
      value={value}
      onKeyDown={numberGuard}
      onWheel={noWheel}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") { onValueChange(0); return; }
        let n = decimal ? parseFloat(raw) : parseInt(raw, 10);
        if (isNaN(n)) return;
        if (min !== undefined && n < min) n = min;
        if (max !== undefined && n > max) n = max;
        onValueChange(n);
      }}
      className={`${inputCls} ${className}`}
    />
  );
}

/** Select with shared styling. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select {...rest} className={`${inputCls} ${className}`}>
      {children}
    </select>
  );
}

/** Textarea with shared styling. */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={`${inputCls} ${className}`} />;
}
