"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { InspectionHeader } from "@/components/inspection/inspection-header";
import { toast } from "@/components/ui/toast";
import { useCustomers, useFacilities, useInspectionBundle, useOrganization, useUsers } from "@/lib/store/hooks";
import { isInspectionLocked, useStore } from "@/lib/store/store";
import { countBySeverity, type Severity } from "@/lib/domain/validation";
import { GENERATOR_COLUMNS, GENERATOR_COLUMN_COUNT, GENERATOR_HEADERS, IRT_COLUMN_COUNT, buildGeneratorRows, exportFileName, inspectionStartDate, parseCsv, toCsv } from "@/lib/domain/csv";
import { downloadText } from "@/lib/download";
import { cn } from "@/lib/cn";
import { ExteriorAckButtons, ExteriorCapture, useFieldState } from "@/components/field/exterior-photos";
import { buildingLabel } from "@/lib/domain/site-visit";
import { useRole } from "@/lib/cloud/role";
import { useSyncStatus } from "@/lib/sync/runtime";
import { LastSynced } from "@/components/sync/sync-status";
import { DownloadExcelButton, confirmSyncComplete } from "@/components/inspection/download-excel";
import { ChangesSinceApproval, DeviceReports, SubmitControl, useDeviceReports } from "@/components/inspection/approval";
import { primaryName } from "@/components/forms/primary-thermographer";

const sevIcon: Record<Severity, React.ReactNode> = {
  error: <AlertCircle className="h-4 w-4 text-red-600" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-sky-500" />,
};

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const bundle = useInspectionBundle(id);
  const org = useOrganization();
  const customers = useCustomers();
  const facilities = useFacilities();
  const setStatus = useStore((s) => s.setInspectionStatus);
  const [show, setShow] = useState<Severity | "all">("all");
  const field = useFieldState(id);
  const { isAdmin, cloud } = useRole();
  const sync = useSyncStatus();
  const users = useUsers();
  const reports = useDeviceReports(bundle?.dataset.inspection ?? ({ id, updatedAt: "", status: "Draft" } as never));
  const facilityId = bundle?.dataset.inspection.facilityId;
  const outstanding = useMemo(() => sync.ops.filter((o) => o.row.inspection_id === id || (o.table === "inspections" && o.id === id) || (facilityId && o.row.facility_id === facilityId)), [sync.ops, id, facilityId]);
  const syncIssues = outstanding.length + sync.conflictList.length;
  const rows = useMemo(() => (bundle ? buildGeneratorRows(bundle.dataset) : []), [bundle]);
  if (!bundle) return <EmptyState title="Inspection not found" action={<Link href="/inspections"><Button>Back</Button></Link>} />;
  const { dataset, issues } = bundle;
  const inspection = dataset.inspection;
  const counts = countBySeverity(issues);
  const includeBom = org?.settings.csvIncludeBom ?? true;
  const customer = customers.find((c) => c.id === inspection.customerId)?.name ?? "Customer";
  const facility = facilities.find((f) => f.id === inspection.facilityId)?.name ?? "Facility";
  const visible = issues.filter((i) => show === "all" || i.severity === show);
  const photoBlocked = !!field && !field.exit.allowed && inspection.siteVisit.state !== "completed" && (inspection.status === "Draft" || inspection.status === "In Progress");

  const exportCsv = async () => {
    if (!(await confirmSyncComplete(id))) return;
    const csv = toCsv(rows, { includeBom });
    // Self-check: re-parse and confirm the structure before handing the file over.
    const parsed = parseCsv(csv);
    const ok = parsed.length === rows.length + 1 && parsed.every((r) => r.length === GENERATOR_COLUMN_COUNT) && parsed[0].join("|") === GENERATOR_HEADERS.join("|");
    if (!ok) { toast("CSV self-check failed. Export cancelled.", "error"); return; }
    downloadText(exportFileName(customer, facility, inspectionStartDate(dataset)), csv);
    toast(`Exported ${rows.length} rows`);
  };

  const jump = (resultId: string | null, locationId: string | null) => {
    if (!resultId) return;
    router.push(`/inspections/${id}/entry?${locationId ? `room=${locationId}&` : ""}focus=${resultId}`);
  };

  return (
    <>
      <InspectionHeader inspection={inspection} errorCount={counts.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Generator export" description={`Infinite Infrared: ${GENERATOR_COLUMN_COUNT} columns · IRT: ${IRT_COLUMN_COUNT} columns · ${rows.length} rows (one per thermal image) · typed Excel cells; CSV kept for compatibility`}
              actions={<>
                <DownloadExcelButton inspectionId={id} size="lg" disabled={rows.length === 0} data-testid="export-xlsx" />
                <Button size="sm" variant="ghost" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-3.5 w-3.5" />CSV (compatibility)</Button>
              </>} />
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky top-0 border-b border-slate-200 bg-slate-100 px-2 py-1.5 text-left font-semibold text-slate-400">#</th>
                    {GENERATOR_COLUMNS.map((c, i) => (
                      <th key={c.header} className="sticky top-0 whitespace-nowrap border-b border-l border-slate-200 bg-slate-100 px-2 py-1.5 text-left font-semibold text-slate-700">
                        <div className="text-[10px] font-normal text-slate-400">{i + 1} · {c.excelColumn ? `Excel ${c.excelColumn}` : "No Generator column"}</div>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {rows.map((r, i) => (
                    <tr key={i} className="odd:bg-white even:bg-slate-50/60">
                      <td className="border-b border-slate-100 px-2 py-1 text-slate-400">{i + 1}</td>
                      {r.map((v, j) => (
                        <td key={j} className={cn("whitespace-nowrap border-b border-l border-slate-100 px-2 py-1", v === "" && "bg-slate-100/60")}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CardBody className="border-t border-slate-100 text-xs text-slate-500">
              {cloud ? <div className="mb-1"><LastSynced />. One combined workbook: every room and equipment line synced from all phones.</div> : null}
              Gray cells are blank and stay blank in the file, so columns never shift. Generator formula columns O, P and Q are never written. Severity and calculated values remain the Generator&apos;s job.
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Approval" />
            <CardBody className="space-y-3 text-sm">
              {counts.error === 0 ? (
                <div className="flex items-center gap-2 text-emerald-700"><ShieldCheck className="h-4 w-4" />No blocking errors.</div>
              ) : (
                <div className="flex items-center gap-2 text-red-700"><AlertCircle className="h-4 w-4" />{counts.error} error{counts.error === 1 ? "" : "s"} must be fixed before approval.</div>
              )}
              {photoBlocked && field ? (
                <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-start gap-2 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Front building photo</strong> still needs a decision before this inspection can go to review: {field.exit.missing.map(buildingLabel).join(", ")}.</span></div>
                  <ExteriorCapture field={field} takeLabel="Take Front Photo" />
                  {field.shared ? field.exit.missing.map((b) => <ExteriorAckButtons key={b} field={field} building={b} />) : null}
                </div>
              ) : null}
              {cloud && syncIssues ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" data-testid="review-sync-warning">
                  <strong>Not fully synced.</strong> {outstanding.length ? `${outstanding.length} change(s) from this phone are not in the cloud yet. ` : ""}{sync.conflictList.length ? `${sync.conflictList.length} conflict(s) need a decision. ` : ""}
                  <Link href="/sync" className="underline">Open Sync</Link>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <SubmitControl inspection={inspection} disabled={photoBlocked || isInspectionLocked(inspection)} onBlocked={() => toast("Front building photo needs a decision first", "error")} />
                {isAdmin ? <Button variant="primary" data-testid="approve" disabled={counts.error > 0 || photoBlocked || isInspectionLocked(inspection) || inspection.status === "Approved"} onClick={() => {
                  const waiting = (reports ?? []).filter((r) => r.pending > 0 || r.failed > 0);
                  if ((waiting.length || syncIssues) && !confirm(`Not everything is confirmed in the cloud:${syncIssues ? `\n• This device: ${outstanding.length} change(s) not uploaded, ${sync.conflictList.length} conflict(s)` : ""}${waiting.map((r) => `\n• Another phone reported ${r.pending} waiting, ${r.failed} failed (${new Date(r.reported_at).toLocaleString("en-US")})`).join("")}\n\nApprove anyway? Late changes will be refused once approved and stay on that phone for review.`)) return;
                  if (setStatus(inspection.id, "Approved", `${counts.warning} warnings acknowledged`)) toast("Inspection approved"); else toast("Front building photo needs a decision before approval", "error");
                }}>
                  <CheckCircle2 className="h-4 w-4" />{inspection.firstApprovedAt ? "Approve again" : "Approve"}
                </Button> : null}
              </div>
              {!isAdmin ? <p className="text-xs text-slate-500">One submission is enough for everyone assigned. An administrator then reviews and approves it.</p> : null}
              {isAdmin ? <DeviceReports rows={reports} /> : null}
              {cloud ? <div className="text-xs text-slate-600" data-testid="review-primary">Primary Thermographer: <strong>{primaryName(inspection, users) ?? "not chosen"}</strong>{inspection.primaryLocked ? " (designated)" : ""}</div> : null}
              <p className="text-xs text-slate-500">Finished PDF report generation is not connected yet. It will be enabled only after your existing Generator is integrated and verified.</p>
            </CardBody>
          </Card>

          <ChangesSinceApproval inspection={inspection} />

          <Card>
            <CardHeader title="Validation" description="Nothing is changed automatically. Fix items in Equipment Entry." />
            <div className="flex gap-1 border-b border-slate-100 px-4 py-2">
              {(["all", "error", "warning", "info"] as const).map((s) => (
                <button key={s} onClick={() => setShow(s)} className={cn("rounded-md px-2 py-1 text-xs font-medium", show === s ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                  {s === "all" ? `All ${issues.length}` : `${s[0].toUpperCase()}${s.slice(1)}s ${counts[s]}`}
                </button>
              ))}
            </div>
            <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
              {visible.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing to show.</li> : visible.map((i) => (
                <li key={i.id}>
                  <button onClick={() => jump(i.resultId, i.locationId)} className="flex w-full gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                    <span className="mt-0.5">{sevIcon[i.severity]}</span>
                    <span className="min-w-0 flex-1"><span className="text-slate-800">{i.message}</span><br /><Badge className="mt-1">{i.field}</Badge></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
