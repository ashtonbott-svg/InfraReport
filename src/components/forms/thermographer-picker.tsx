"use client";

import { Field, Select } from "@/components/ui/field";
import { useUsers } from "@/lib/store/hooks";
import type { User } from "@/lib/domain/types";
import { useRole } from "@/lib/cloud/role";

export function inspectorNames(ids: string[], users: User[]): string {
  const names = ids.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
  return names.length ? names.join(" & ") : "No thermographer selected";
}

/**
 * Lead thermographer plus an optional second thermographer. These are names
 * chosen for the record, not authenticated user accounts.
 */
export function ThermographerPicker({ value, onChange, idPrefix = "th", readOnly }: { value: string[]; onChange: (ids: string[]) => void; idPrefix?: string; readOnly?: boolean }) {
  const users = useUsers();
  const { cloud } = useRole();
  if (readOnly) {
    return <Field label="Thermographers" htmlFor={`${idPrefix}-ro`}><div id={`${idPrefix}-ro`} className="py-2 text-sm text-slate-700">{inspectorNames(value, users)} <span className="text-xs text-slate-400">(assigned by an administrator)</span></div></Field>;
  }
  if (cloud) {
    // Shared accounts: assign one or more people. Assigned technicians see this job on their phones.
    const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
      <Field label="Assigned thermographers *" htmlFor={`${idPrefix}-multi`} hint="Only assigned technicians can see and work on this inspection.">
        <div id={`${idPrefix}-multi`} className="grid gap-2 sm:grid-cols-2">
          {users.map((u) => (
            <label key={u.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value.includes(u.id) ? "border-thermal-500 bg-thermal-50" : "border-slate-200"}`}>
              <input type="checkbox" className="h-4 w-4" checked={value.includes(u.id)} onChange={() => toggle(u.id)} data-testid={`assign-${u.name}`} />
              <span><span className="font-medium text-slate-900">{u.name}</span>{u.certification ? <span className="block text-xs text-slate-500">{u.certification}</span> : null}</span>
            </label>
          ))}
        </div>
      </Field>
    );
  }
  const lead = value[0] ?? "";
  const second = value[1] ?? "";
  const label = (u: User) => `${u.name}${u.certification ? `, ${u.certification}` : ""}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Thermographer *" htmlFor={`${idPrefix}-lead`}>
        <Select id={`${idPrefix}-lead`} className="h-11 text-base sm:h-9 sm:text-sm" value={lead} onChange={(e) => onChange([e.target.value, ...(second && second !== e.target.value ? [second] : [])].filter(Boolean))}>
          <option value="">Select thermographer…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
        </Select>
      </Field>
      <Field label="Second thermographer (optional)" htmlFor={`${idPrefix}-second`}>
        <Select id={`${idPrefix}-second`} className="h-11 text-base sm:h-9 sm:text-sm" value={second} disabled={!lead} onChange={(e) => onChange([lead, e.target.value].filter(Boolean))}>
          <option value="">None</option>
          {users.filter((u) => u.id !== lead).map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
        </Select>
      </Field>
    </div>
  );
}
