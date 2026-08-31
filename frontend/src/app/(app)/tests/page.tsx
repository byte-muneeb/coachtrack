"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { testsApi, coursesApi, getUser, type Test, type TestInput, type Course, type Batch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { fmtDate } from "@/lib/date";

const CAN_WRITE = new Set(["entity_admin", "branch_manager", "teacher"]);
const selCls = "rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md outline-none focus:border-secondary";
const inputCls = "w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md outline-none focus:border-secondary";

export default function TestsPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const canWrite = useMemo(() => { const u = getUser(); return u ? CAN_WRITE.has(String(u.role)) : false; }, []);

  useEffect(() => { coursesApi.list().then(setCourses).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setTests(await testsApi.list({ courseId: courseId || undefined, search })); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load tests"); }
    finally { setLoading(false); }
  }, [courseId, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  async function remove(id: number) {
    try { await testsApi.remove(id); setConfirmDel(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  const chip = "rounded-md px-sm py-[3px] font-label-md text-label-md font-semibold";

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1000px] space-y-lg">
        <PageHeader
          title="Tests & Results"
          subtitle="Create tests (single total or subject-wise), enter marks, and publish ranked result cards."
          icon="quiz"
          actions={canWrite ? (
            <button onClick={() => setModal(true)} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> New test
            </button>
          ) : undefined}
        />

        <div className="flex flex-wrap items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
          <select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))} className={selCls} title="Course">
            <option value={0}>All courses</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex flex-1 items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm">
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search test name"
              className="w-full bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant/70" />
          </label>
        </div>

        {error && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">Test</th><th className="px-md py-sm">Course / Batch</th>
                <th className="px-md py-sm">Date</th><th className="px-md py-sm text-right">Total</th>
                <th className="px-md py-sm text-center">Marks in</th><th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-md py-xl text-center font-body-md text-on-surface-variant">Loading…</td></tr>
              ) : tests.length === 0 ? (
                <tr><td colSpan={6} className="px-md py-xl text-center font-body-md text-on-surface-variant">No tests yet. Create one to start recording marks.</td></tr>
              ) : tests.map((t) => (
                <tr key={t.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm">
                    <Link href={`/tests/${t.id}`} className="font-body-md text-body-md font-medium text-secondary hover:underline">{t.name}</Link>
                    <p className="font-label-md text-label-md text-on-surface-variant">{t.subjectCount ? `${t.subjectCount} subjects` : "Single total"} · pass {t.passingMarks}</p>
                  </td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{[t.courseName, t.batchName].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md">{t.testDate ? fmtDate(t.testDate) : "—"}</td>
                  <td className="px-md py-sm text-right font-mono-data text-mono-data">{t.totalMarks}</td>
                  <td className="px-md py-sm text-center">
                    <span className={`${chip} ${t.resultCount ? "bg-emerald-50 text-emerald-700" : "bg-surface-container text-on-surface-variant"}`}>{t.resultCount || 0}</span>
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex items-center justify-end gap-xs">
                      <Link href={`/tests/${t.id}`} className="rounded-md border border-outline-variant px-sm py-[3px] font-label-md text-label-md text-primary hover:bg-surface-container-high">Enter marks</Link>
                      {canWrite && (confirmDel === t.id ? (
                        <>
                          <button onClick={() => remove(t.id)} className="rounded-md bg-error px-sm py-[3px] font-label-md text-label-md text-on-error">Confirm</button>
                          <button onClick={() => setConfirmDel(null)} className="rounded-md border border-outline-variant px-sm py-[3px] font-label-md text-label-md">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDel(t.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <CreateTest courses={courses} onClose={() => setModal(false)} onCreated={() => { setModal(false); load(); }} />}
    </main>
  );
}

function CreateTest({ courses, onClose, onCreated }: { courses: Course[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [testDate, setTestDate] = useState("");
  const [passingMarks, setPassingMarks] = useState("");
  const [mode, setMode] = useState<"single" | "subjects">("single");
  const [totalMarks, setTotalMarks] = useState("");
  const [subjects, setSubjects] = useState<{ name: string; maxMarks: string }[]>([{ name: "", maxMarks: "" }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBatchId("");
    if (!courseId) { setBatches([]); return; }
    coursesApi.get(Number(courseId)).then((c) => setBatches(c.batches ?? [])).catch(() => setBatches([]));
  }, [courseId]);

  const subjectTotal = subjects.reduce((a, s) => a + (Number(s.maxMarks) || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Test name is required"); return; }
    if (!courseId) { setErr("Choose a course"); return; }
    const subj = subjects.map((s) => ({ name: s.name.trim(), maxMarks: Number(s.maxMarks) || 0 })).filter((s) => s.name);
    if (mode === "subjects" && !subj.length) { setErr("Add at least one subject"); return; }
    if (mode === "single" && !(Number(totalMarks) > 0)) { setErr("Total marks must be greater than 0"); return; }
    setSaving(true); setErr(null);
    try {
      const payload: TestInput = {
        name: name.trim(), courseId: Number(courseId), batchId: batchId ? Number(batchId) : null,
        testDate: testDate || null, passingMarks: Number(passingMarks) || 0,
      };
      if (mode === "subjects") payload.subjects = subj; else payload.totalMarks = Number(totalMarks);
      await testsApi.create(payload);
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to create test"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-[640px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-md text-headline-md font-semibold text-primary">New test</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-container-high"><span className="material-symbols-outlined text-on-surface-variant">close</span></button>
        </div>
        {err && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{err}</div>}

        <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Test name *</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="MDCAT Mock 1" /></label>
        <div className="grid grid-cols-2 gap-md">
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Course *</span>
            <select className={inputCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Select course…</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Batch (optional)</span>
            <select className={inputCls} value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!courseId}>
              <option value="">All batches</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.timeSlot ? ` — ${b.timeSlot}` : ""}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Test date</span><input type="date" className={inputCls} value={testDate} onChange={(e) => setTestDate(e.target.value)} /></label>
          <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Passing marks</span><input type="number" min={0} className={inputCls} value={passingMarks} onChange={(e) => setPassingMarks(e.target.value)} placeholder="0" /></label>
        </div>

        <div className="flex gap-xs rounded-lg bg-surface-container p-[3px] w-fit">
          {(["single", "subjects"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-md py-[6px] font-label-md text-label-md font-semibold ${mode === m ? "bg-surface text-primary shadow-sm" : "text-on-surface-variant"}`}>
              {m === "single" ? "Single total" : "Subject-wise"}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <label className="flex w-[220px] flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Total marks *</span><input type="number" min={1} className={inputCls} value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} placeholder="200" /></label>
        ) : (
          <div className="space-y-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-md text-label-md text-on-surface-variant">Subjects (total {subjectTotal})</span>
              <button type="button" onClick={() => setSubjects((p) => [...p, { name: "", maxMarks: "" }])} className="flex items-center gap-xs font-label-md text-label-md text-secondary hover:underline"><span className="material-symbols-outlined text-[16px]">add</span> Add subject</button>
            </div>
            {subjects.map((s, i) => (
              <div key={i} className="flex items-center gap-sm">
                <input className={inputCls} placeholder="Biology" value={s.name} onChange={(e) => setSubjects((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input type="number" min={0} className="w-[120px] rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md outline-none focus:border-secondary" placeholder="Max" value={s.maxMarks} onChange={(e) => setSubjects((p) => p.map((x, j) => j === i ? { ...x, maxMarks: e.target.value } : x))} />
                {subjects.length > 1 && <button type="button" onClick={() => setSubjects((p) => p.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container"><span className="material-symbols-outlined text-[18px]">close</span></button>}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-sm pt-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Creating…" : "Create test"}</button>
        </div>
      </form>
    </div>
  );
}
