"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { studentsApi, coursesApi, enrollmentsApi, branchesApi, type Course, type Batch, type Branch } from "@/lib/api";
import { Field, TextInput, Select, inputCls, numberGuard, noWheel } from "@/components/form";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

type Enroll = { batchId: number; courseName: string; batchName: string; monthlyFee: number; discount: number };

export default function RegisterPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // personal / guardian
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("Father");
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);

  // enrollment picker
  const [courses, setCourses] = useState<Course[]>([]);
  const [batchesByCourse, setBatchesByCourse] = useState<Record<number, Batch[]>>({});
  const [pickCourse, setPickCourse] = useState("");
  const [pickBatch, setPickBatch] = useState("");
  const [pickDiscount, setPickDiscount] = useState(0);
  const [enrollments, setEnrollments] = useState<Enroll[]>([]);

  useEffect(() => {
    coursesApi.list().then(setCourses).catch(() => setCourses([]));
    branchesApi.list().then(setBranches).catch(() => setBranches([]));
  }, []);

  const selectedCourse = courses.find((c) => String(c.id) === pickCourse);
  const courseBatches = selectedCourse ? batchesByCourse[selectedCourse.id] : undefined;

  async function onPickCourse(id: string) {
    setPickCourse(id);
    setPickBatch("");
    const cid = Number(id);
    if (cid && !batchesByCourse[cid]) {
      try {
        const full = await coursesApi.get(cid);
        setBatchesByCourse((p) => ({ ...p, [cid]: full.batches || [] }));
      } catch {
        setBatchesByCourse((p) => ({ ...p, [cid]: [] }));
      }
    }
  }

  function addEnrollment() {
    if (!selectedCourse || !pickBatch) return;
    const batch = (courseBatches || []).find((b) => String(b.id) === pickBatch);
    if (!batch) return;
    if (enrollments.some((e) => e.batchId === batch.id)) return;
    const monthlyFee = batch.monthlyFee || 0;
    setEnrollments((p) => [
      ...p,
      { batchId: batch.id, courseName: selectedCourse.name, batchName: batch.name, monthlyFee, discount: Math.min(pickDiscount, monthlyFee) },
    ]);
    setPickBatch("");
    setPickDiscount(0);
  }
  function removeEnrollment(batchId: number) {
    setEnrollments((p) => p.filter((e) => e.batchId !== batchId));
  }

  // Net = monthly fee minus discount, floored at 0.
  const totalMonthly = enrollments.reduce((s, e) => s + Math.max(0, (e.monthlyFee || 0) - (e.discount || 0)), 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setError("Full name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await studentsApi.create({
        fullName,
        email: email || null,
        phone: phone || null,
        dateOfBirth: dateOfBirth || null,
        address: address || null,
        guardianName: guardianName || null,
        guardianRelation: guardianRelation || null,
        course: enrollments[0]?.courseName || null,
        batch: enrollments[0]?.batchName || null,
        status,
        branchId: branchId ? Number(branchId) : null,
        notes: notes || null,
      });
      // create each batch enrollment (fees come from the batch)
      for (const en of enrollments) {
        try { await enrollmentsApi.create({ studentId: created.id, batchId: en.batchId, discount: en.discount || 0 }); } catch { /* skip dup */ }
      }
      router.push(`/students/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register student");
      setSaving(false);
    }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <form onSubmit={onSubmit} className="mx-auto max-w-[960px] space-y-lg">
        <div className="flex items-end justify-between border-b border-outline-variant pb-md">
          <div>
            <h1 className="font-display text-[24px] font-bold tracking-tight text-primary">Student Registration</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">Onboard a new student and enroll them in one or more batches.</p>
          </div>
          <Link href="/students" className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">
            Cancel
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>
        )}

        {/* Personal */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="mb-md flex items-center gap-xs font-headline-md text-headline-md font-semibold text-primary">
            <span className="material-symbols-outlined text-secondary">person</span> Personal Information
          </h2>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <Field label="Full Name" required>
              <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
            <Field label="Phone Number">
              <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
            </Field>
            <Field label="Email Address">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Date of Birth">
              <TextInput type="date" value={dateOfBirth} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Residential Address" className="sm:col-span-2">
              <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
        </section>

        {/* Guardian */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="mb-md flex items-center gap-xs font-headline-md text-headline-md font-semibold text-primary">
            <span className="material-symbols-outlined text-secondary">family_restroom</span> Guardian
          </h2>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
            <Field label="Guardian Name" className="sm:col-span-2">
              <TextInput value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
            </Field>
            <Field label="Relation">
              <Select value={guardianRelation} onChange={(e) => setGuardianRelation(e.target.value)}>
                {["Father", "Mother", "Sibling", "Guardian", "Other"].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* Enrollment */}
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h2 className="mb-xs flex items-center gap-xs font-headline-md text-headline-md font-semibold text-primary">
            <span className="material-symbols-outlined text-secondary">history_edu</span> Batch Enrollment
          </h2>
          <p className="mb-md font-label-md text-label-md text-on-surface-variant">
            Add one or more batches. Monthly fees are taken from each batch and billed via monthly vouchers.
          </p>

          <div className="flex flex-wrap items-end gap-sm">
            <label className="flex flex-1 min-w-[200px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Course</span>
              <Select value={pickCourse} onChange={(e) => onPickCourse(e.target.value)}>
                <option value="">Select course…</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>
            <label className="flex flex-1 min-w-[200px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Batch</span>
              <Select value={pickBatch} onChange={(e) => setPickBatch(e.target.value)} disabled={!selectedCourse}>
                <option value="">{!selectedCourse ? "Pick a course first" : courseBatches === undefined ? "Loading…" : "Select batch…"}</option>
                {(courseBatches || []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.timeSlot ? ` (${b.timeSlot})` : ""} — {rs(b.monthlyFee || 0)}/mo</option>
                ))}
              </Select>
            </label>
            <label className="flex w-[150px] flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Discount (Rs/mo)</span>
              <input type="number" min={0} inputMode="numeric" placeholder="0" disabled={!pickBatch}
                onKeyDown={numberGuard} onWheel={noWheel} className={inputCls}
                value={pickDiscount || ""} onChange={(e) => setPickDiscount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <button type="button" onClick={addEnrollment} disabled={!pickBatch}
              className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">add</span> Add
            </button>
          </div>

          {enrollments.length > 0 && (
            <div className="mt-md overflow-hidden rounded-lg border border-outline-variant">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
                  <tr><th className="px-md py-sm">Course</th><th className="px-md py-sm">Batch</th><th className="px-md py-sm text-right">Monthly Fee</th><th className="px-md py-sm text-right">Discount</th><th className="px-md py-sm text-right">Net/mo</th><th className="px-md py-sm"></th></tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {enrollments.map((en) => (
                    <tr key={en.batchId}>
                      <td className="px-md py-sm font-body-md text-body-md">{en.courseName}</td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{en.batchName}</td>
                      <td className="px-md py-sm text-right font-mono-data text-mono-data">{rs(en.monthlyFee)}</td>
                      <td className="px-md py-sm text-right font-mono-data text-mono-data">{en.discount > 0 ? <span className="text-green-700">− {rs(en.discount)}</span> : "—"}</td>
                      <td className="px-md py-sm text-right font-mono-data text-mono-data font-semibold text-primary">{rs(Math.max(0, en.monthlyFee - (en.discount || 0)))}</td>
                      <td className="px-md py-sm text-right">
                        <button type="button" onClick={() => removeEnrollment(en.batchId)} className="text-error hover:underline font-label-md text-label-md">Remove</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface-container-low">
                    <td className="px-md py-sm font-body-md text-body-md font-semibold text-primary" colSpan={4}>Total Net Monthly</td>
                    <td className="px-md py-sm text-right font-mono-data text-mono-data font-semibold text-primary">{rs(totalMonthly)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-md grid grid-cols-1 gap-md sm:grid-cols-3">
            <Field label="Branch">
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {["active", "pending", "graduated", "suspended"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Notes">
              <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </section>

        <div className="flex justify-end gap-sm">
          <Link href="/students" className="rounded-lg border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-xs rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">
            <span className="material-symbols-outlined text-[18px]">save</span>{saving ? "Saving…" : "Register Student"}
          </button>
        </div>
      </form>
    </main>
  );
}
