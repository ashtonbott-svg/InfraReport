"use client";

import { Camera, Lock } from "lucide-react";
import { Field, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useUsers } from "@/lib/store/hooks";
import { isInspectionLocked, useStore } from "@/lib/store/store";
import type { Inspection, User } from "@/lib/domain/types";

export function primaryName(inspection: Pick<Inspection, "primaryThermographerId">, users: User[]): string | null {
  return inspection.primaryThermographerId ? users.find((u) => u.id === inspection.primaryThermographerId)?.name ?? null : null;
}

/**
 * Primary Thermographer: the person responsible for the camera and photographs.
 * Administrators can designate one (authoritative) or leave it to the field team.
 * Field users choose among the people assigned, unless an administrator decided.
 */
export function PrimaryThermographerField({ inspection, admin, idPrefix = "pt" }: { inspection: Inspection; admin: boolean; idPrefix?: string }) {
  const users = useUsers();
  const set = useStore((s) => s.setPrimaryThermographer);
  const assigned = users.filter((u) => inspection.inspectorIds.includes(u.id));
  const locked = !!inspection.primaryLocked && !admin;
  const approved = isInspectionLocked(inspection);
  return (
    <Field label="Primary Thermographer" htmlFor={`${idPrefix}-primary`}
      hint={admin ? "Optional. Leave it to the field team, or designate one person (technicians then cannot change it)." : locked ? "Designated by an administrator." : "The person responsible for the camera and photographs. Everyone assigned can still enter data."}>
      <div className="flex items-center gap-2">
        <Select id={`${idPrefix}-primary`} className="h-11 text-base sm:h-9 sm:text-sm" value={inspection.primaryThermographerId ?? ""} disabled={locked || approved || assigned.length === 0}
          data-testid="primary-select"
          onChange={(e) => {
            const v = e.target.value || null;
            if (!set(inspection.id, v, { designate: admin && !!v })) toast("An administrator designated the primary thermographer", "error");
          }}>
          <option value="">{admin ? "Let the field team decide" : "Not chosen yet"}</option>
          {assigned.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        {inspection.primaryLocked ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500" title="Designated by an administrator"><Lock className="h-3.5 w-3.5" />Designated</span> : null}
      </div>
    </Field>
  );
}

/** Asked when field work starts on a shared inspection with several people and no primary chosen. */
export function PrimaryPromptSheet({ inspection, onDone }: { inspection: Inspection; onDone: () => void }) {
  const users = useUsers();
  const set = useStore((s) => s.setPrimaryThermographer);
  const assigned = users.filter((u) => inspection.inspectorIds.includes(u.id));
  return (
    <Sheet open onClose={onDone} title="Who is the Primary Thermographer?" subtitle="The person responsible for the infrared camera and photographs on this job. Everyone assigned can still enter data. You can change this until the inspection is submitted.">
      <div className="grid gap-2" data-testid="primary-prompt">
        {assigned.map((u) => (
          <button key={u.id} type="button" onClick={() => { if (set(inspection.id, u.id)) toast(`${u.name} is the Primary Thermographer`); onDone(); }}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left hover:bg-slate-50">
            <Camera className="h-5 w-5 shrink-0 text-slate-500" />
            <span><span className="block text-base font-semibold text-slate-900">{u.name}</span>{u.certification ? <span className="block text-xs text-slate-500">{u.certification}</span> : null}</span>
          </button>
        ))}
        <Button variant="ghost" className="h-11 justify-center" onClick={onDone}>Decide later</Button>
      </div>
    </Sheet>
  );
}
