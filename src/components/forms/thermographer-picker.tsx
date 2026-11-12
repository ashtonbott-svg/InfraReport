"use client";

import { Field, Select } from "@/components/ui/field";
import { useUsers } from "@/lib/store/hooks";
import type { User } from "@/lib/domain/types";

export function inspectorNames(ids: string[], users: User[]): string {
  const names = ids.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
  return names.length ? names.join(" & ") : "No thermographer selected";
}

/**
 * Lead thermographer plus an optional second thermographer. These are names
 * chosen for the record, not authenticated user accounts.
 */
export function ThermographerPicker({ value, onChange, idPrefix = "th" }: { value: string[]; onChange: (ids: string[]) => void; idPrefix?: string }) {
  const users = useUsers();
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
