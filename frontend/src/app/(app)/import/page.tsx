"use client";

import { useEffect, useState } from "react";
import { coursesApi, studentsApi, branchesApi, getUser, type Branch, type ImportResult, type ImportRow } from "@/lib/api";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

const COURSE_COLS = ["name", "code", "level", "durationMonths", "admissionFee", "monthlyFee", "examFee", "branch"];
const COURSE_EX = ["MDCAT Prep", "MD-01", "Advanced", "6", "5000", "8000", "3000", "Main Branch"];
const STUDENT_COLS = ["fullName", "phone", "email", "registryId", "guardianName", "guardianRelation", "dateOfBirth", "address", "course", "batch", "branch", "status", "discountPct", "scholarship", "notes"];
const STUDENT_EX = ["Ahmed Raza", "0300-1234567", "ahmed@example.com", "", "Raza Khan", "Father", "2005-06-15", "12 Model Town", "MDCAT Prep", "Morning A", "Main Branch", "active", "0", "0", ""];

const ALLOWED = new Set(["entity_admin", "branch_manager", "front_desk"]);

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function downloadTemplate(filename: string, cols: string[], example: string[]) {
  const csv = cols.join(",") + "\n" + example.map(csvCell).join(",") + "\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function Summary({ r }: { r: ImportResult }) {
  return (
    <div className="mt-md space-y-sm">
      <div className="flex flex-wrap gap-sm text-[13px]">
        <span className="rounded-md bg-green-100 px-sm py-[3px] font-semibold text-green-800">{r.validateOnly ? "Will import" : "Imported"}: {r.created}</span>
        <span className="rounded-md bg-amber-100 px-sm py-[3px] font-semibold text-amber-800">Skipped: {r.skipped.length}</span>
        <span className="rounded-md bg-red-100 px-sm py-[3px] font-semibold text-red-800">Errors: {r.errors.length}</span>
        <span className="rounded-md bg-surface-container px-sm py-[3px] text-on-surface-variant">Total rows: {r.total}</span>
      </div>
      {(r.errors.length > 0 || r.skipped.length > 0) && (
        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-outline-variant">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-container text-on-surface-variant"><tr><th className="px-sm py-[4px]">Row</th><th className="px-sm py-[4px]">Type</th><th className="px-sm py-[4px]">Reason</th></tr></thead>
            <tbody>
              {r.errors.map((x, i) => <tr key={`e${i}`} className="border-t border-outline-variant"><td className="px-sm py-[4px]">{x.row}</td><td className="px-sm py-[4px] text-red-700">Error</td><td className="px-sm py-[4px]">{x.reason}</td></tr>)}
              {r.skipped.map((x, i) => <tr key={`s${i}`} className="border-t border-outline-variant"><td className="px-sm py-[4px]">{x.row}</td><td className="px-sm py-[4px] text-amber-700">Skipped</td><td className="px-sm py-[4px]">{x.reason}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImportSection({
  step, title, hint, cols, example, templateName, disabled, run,
}: {
  step: number; title: string; hint: string; cols: string[]; example: string[]; templateName: string;
  disabled?: boolean; run: (rows: ImportRow[], validateOnly: boolean) => Promise<ImportResult>;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setResult(null); setPreview(null); setRows(null);
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setBusy(true);
    try {
      const parsed = await parseSpreadsheet(f);
      if (!parsed.length) { setErr("No data rows found in that file."); setBusy(false); return; }
      setRows(parsed);
      setPreview(await run(parsed, true)); // dry-run preview
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not read the file"); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!rows) return; setBusy(true); setErr(null);
    try { setResult(await run(rows, false)); setPreview(null); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Import failed"); }
    finally { setBusy(false); }
  }

  return (
    <section className={`rounded-2xl border border-outline-variant bg-surface p-lg ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-sm">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[13px] font-bold text-on-secondary">{step}</span>
        <h2 className="font-headline-md text-[17px] font-semibold text-on-surface">{title}</h2>
      </div>
      <p className="mt-xs font-body-md text-body-md text-on-surface-variant">{hint}</p>

      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button onClick={() => downloadTemplate(templateName, cols, example)}
          className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container">
          <span className="material-symbols-outlined text-[18px]">download</span> Download template
        </button>
        <label className={`flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 ${disabled ? "pointer-events-none" : "cursor-pointer"}`}>
          <span className="material-symbols-outlined text-[18px]">upload_file</span> Choose CSV / Excel
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={disabled} onChange={onFile} />
        </label>
        {fileName && <span className="font-label-md text-label-md text-on-surface-variant">{fileName}</span>}
        {busy && <span className="font-label-md text-label-md text-on-surface-variant">Working…</span>}
      </div>

      {err && <div className="mt-md rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}

      {preview && (
        <>
          <p className="mt-md font-label-md text-label-md font-semibold text-on-surface">Preview (nothing saved yet)</p>
          <Summary r={preview} />
          <button onClick={confirm} disabled={busy || preview.created === 0}
            className="mt-md rounded-lg bg-primary px-lg py-sm font-label-md text-label-md font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
            Confirm import of {preview.created} row{preview.created === 1 ? "" : "s"}
          </button>
        </>
      )}
      {result && (
        <>
          <p className="mt-md font-label-md text-label-md font-semibold text-green-700">✓ Import complete</p>
          <Summary r={result} />
        </>
      )}
    </section>
  );
}

export default function ImportPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const u = getUser();
    if (u && !ALLOWED.has(String(u.role))) { setAllowed(false); return; }
    branchesApi.list().then((b) => {
      setBranches(b);
      const primary = b.find((x) => x.isPrimary) || b[0];
      if (primary) setBranchId(primary.id);
    }).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load branches"));
  }, []);

  if (!allowed) {
    return <main className="ml-[280px] p-margin-desktop pt-24"><p className="text-on-surface-variant">You don&apos;t have access to data import.</p></main>;
  }

  const guardBranch = (fn: (rows: ImportRow[], validateOnly: boolean, branchId: number) => Promise<ImportResult>) =>
    (rows: ImportRow[], validateOnly: boolean): Promise<ImportResult> => {
      if (branchId == null) return Promise.reject(new Error("Select a target branch first"));
      return fn(rows, validateOnly, branchId);
    };

  return (
    <main className="ml-[280px] min-h-screen p-margin-desktop pt-24">
      <div className="mx-auto max-w-[860px]">
        <h1 className="font-headline-md text-headline-md font-semibold text-on-surface">Import Data</h1>
        <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
          Onboard an institute from a spreadsheet. Import <b>courses first</b>, then students — a student&apos;s course must
          already exist (matching is case-insensitive, so &quot;mdcat prep&quot; matches &quot;MDCAT Prep&quot;).
        </p>

        <div className="mt-md flex items-center gap-sm">
          <label className="font-label-md text-label-md text-on-surface-variant">Target branch</label>
          <select value={branchId ?? ""} onChange={(e) => setBranchId(Number(e.target.value))}
            className="rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md outline-none focus:border-secondary">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? " (Main)" : ""}</option>)}
          </select>
          <span className="font-label-md text-label-md text-on-surface-variant">Rows without a branch column go here.</span>
        </div>
        {err && <div className="mt-md rounded-lg border border-error bg-error-container px-md py-sm text-on-error-container">{err}</div>}

        <div className="mt-lg space-y-lg">
          <ImportSection
            step={1} title="Import Courses" templateName="courses-template.csv"
            hint="Columns: name (required), code, level, durationMonths, admissionFee, monthlyFee, examFee, branch. Duplicate course names (any capitalisation) are skipped."
            cols={COURSE_COLS} example={COURSE_EX}
            run={guardBranch((rows, validateOnly, bId) => coursesApi.importRows({ rows, branchId: bId, validateOnly }))}
          />
          <ImportSection
            step={2} title="Import Students" templateName="students-template.csv"
            hint="Columns: fullName (required), phone, email, registryId (auto if blank), guardianName, guardianRelation, dateOfBirth, address, course (must exist), batch, branch, status, discountPct, scholarship, notes. Duplicates (same registryId or phone) are skipped."
            cols={STUDENT_COLS} example={STUDENT_EX}
            run={guardBranch((rows, validateOnly, bId) => studentsApi.importRows({ rows, branchId: bId, validateOnly }))}
          />
        </div>
      </div>
    </main>
  );
}
