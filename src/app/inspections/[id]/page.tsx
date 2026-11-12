"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, ClipboardCheck, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, Stat } from "@/components/ui/misc";
import { InspectionHeader } from "@/components/inspection/inspection-header";
import { useInspectionBundle, useReviewEvents, useUsers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { countBySeverity } from "@/lib/domain/validation";
import { locationLabel } from "@/lib/domain/csv";
import { formatDateTime } from "@/lib/format";
import { POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import { ExteriorCapture, ExteriorChecklist, useFieldState } from "@/components/field/exterior-photos";
import { useBeginFieldWork } from "@/lib/store/field-actions";
import { visitDayCount } from "@/lib/domain/site-visit";
import { Play } from "lucide-react";
import { ThermographerPicker } from "@/components/forms/thermographer-picker";

export default function InspectionOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const bundle = useInspectionBundle(id);
  const events = useReviewEvents().filter((e) => e.inspectionId === id).sort((a, b) => b.at.localeCompare(a.at));
  const users = useUsers();
  const updateInspection = useStore((s) => s.updateInspection);
  const field = useFieldState(id);
  const activeId = useStore((s) => s.activeInspectionId);
  const begin = useBeginFieldWork();

  if (!bundle) return <EmptyState title="Inspection not found" action={<Link href="/inspections"><Button>Back</Button></Link>} />;
  const { dataset, issues } = bundle;
  const { inspection, results, rooms } = dataset;
  const counts = countBySeverity(issues);
  const problems = results.filter((r) => r.possibleCause && r.possibleCause !== POSSIBLE_CAUSE_NONE).length;
  const locs = dataset.locations as Map<string, import("@/lib/domain/types").Location>;

  return (
    <>
      <InspectionHeader inspection={inspection} errorCount={counts.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Equipment rows" value={results.length} sub={`${rooms.length} rooms`} />
        <Stat label="Problems documented" value={problems} />
        <Stat label="Validation errors" value={<span className={counts.error ? "text-red-600" : ""}>{counts.error}</span>} sub={`${counts.warning} warnings`} />
        <Stat label="Missing image #" value={results.filter((r) => !r.irImageNumber && !r.visualImageNumber).length} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {field ? (
            <Card>
              <CardHeader title="Site visit" description={`State: ${inspection.siteVisit.state.replace("-", " ")} · ${visitDayCount(inspection)} visit day(s)`}
                actions={activeId !== id && inspection.siteVisit.state !== "completed" && !activeId ? (
                  <Button variant="primary" onClick={() => begin(id)}><Play className="h-4 w-4" />{inspection.siteVisit.state === "paused" ? "Resume Inspection" : "Start Site Visit"}</Button>
                ) : null} />
              <CardBody className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Building exterior photos</h3>
                  <ExteriorChecklist field={field} />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add exterior photo</h3>
                  <ExteriorCapture field={field} takeLabel={field.exit.allowed ? "Add Another Photo" : "Take Photo"} />
                  {inspection.siteVisit.sessions.length ? (
                    <ul className="mt-4 space-y-1 text-xs text-slate-500">
                      {inspection.siteVisit.sessions.map((s, i) => <li key={i}>Visit {i + 1}: {formatDateTime(s.startedAt)} to {s.endedAt ? formatDateTime(s.endedAt) : "now"}</li>)}
                    </ul>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Next step" />
            <CardBody className="flex flex-wrap gap-3">
              <Link href={`/inspections/${id}/entry`}><Button variant="primary"><ListPlus className="h-4 w-4" />Open equipment entry</Button></Link>
              <Link href={`/inspections/${id}/review`}><Button><ClipboardCheck className="h-4 w-4" />Review & export CSV</Button></Link>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Inspection settings" />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Inspection date" htmlFor="o-date"><Input id="o-date" type="date" value={inspection.date} onChange={(e) => updateInspection(id, { date: e.target.value })} /></Field>
              <div className="sm:col-span-3"><ThermographerPicker idPrefix="o-th" value={inspection.inspectorIds} onChange={(ids) => updateInspection(id, { inspectorIds: ids })} /></div>
              <Field label="Default emissivity" htmlFor="o-em" hint="0.95 unless explicitly changed. Rows can override.">
                <Input id="o-em" inputMode="decimal" value={inspection.defaultEmissivity} onChange={(e) => updateInspection(id, { defaultEmissivity: e.target.value })} />
              </Field>
              <Field label="Notes" className="sm:col-span-3" htmlFor="o-notes"><Textarea id="o-notes" value={inspection.notes} onChange={(e) => updateInspection(id, { notes: e.target.value })} /></Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Rooms" />
            <CardBody className="grid gap-2 sm:grid-cols-2">
              {rooms.length === 0 ? <p className="text-sm text-slate-500">No rooms yet.</p> : rooms.map((r) => (
                <Link key={r.id} href={`/inspections/${id}/entry?room=${r.locationId}`} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-thermal-300">
                  <span className="font-medium text-slate-800">{locationLabel(locs.get(r.locationId))}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">{results.filter((x) => x.locationId === r.locationId).length} items<ArrowRight className="h-3 w-3" /></span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Review history" description="Audit trail for this inspection" />
          <CardBody className="space-y-3">
            {events.length === 0 ? <p className="text-sm text-slate-500">No events.</p> : events.map((e) => (
              <div key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                <div className="font-medium text-slate-800">{e.action}</div>
                <div className="text-xs text-slate-500">{e.detail}</div>
                <div className="text-[11px] text-slate-400">{formatDateTime(e.at)} · {users.find((u) => u.id === e.actorId)?.name}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
