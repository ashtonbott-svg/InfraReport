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
import { useCustomers, useFacilities, useInspectionBundle, useOrganization } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { countBySeverity, type Severity } from "@/lib/domain/validation";
import { GENERATOR_COLUMNS, GENERATOR_HEADERS, buildGeneratorRows, exportFileName, parseCsv, toCsv } from "@/lib/domain/csv";
import { downloadText } from "@/lib/download";
import { cn } from "@/lib/cn";

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
  const logEvent = useStore((s) => s.logEvent);
  const [show, setShow] = useState<Severity | "all">("all");

  const rows = useMemo(() => (bundle ? buildGeneratorRows(bundle.dataset) : []), [bundle]);
  if (!bundle) return <EmptyState title="Inspection not found" action={<Link href="/inspections"><Button>Back</Button></Link>} />;
  const { dataset, issues } = bundle;
  const inspection = dataset.inspection;
  const counts = countBySeverity(issues);
  const includeBom = org?.settings.csvIncludeBom ?? true;
  const customer = customers.find((c) => c.id === inspection.customerId)?.name ?? "Customer";
  const facility = facilities.find((f) => f.id === inspection.facilityId)?.name ?? "Facility";
  const visible = issues.filter((i) => show === "all" || i.severity === show);

  const exportCsv = () => {
    const csv = toCsv(rows, { includeBom });
    // Self-check: re-parse and confirm the structure before handing the file over.
    const parsed = parseCsv(csv);
    const ok = parsed.length === rows.length + 1 && parsed.every((r) => r.length === 16) && parsed[0].join("|") === GENERATOR_HEADERS.join("|");
    if (!ok) { toast("CSV self-check failed. Export cancelled.", "error"); return; }
    downloadText(exportFileName(customer, facility, inspection.date), csv);
    logEvent(inspection.id, "Generator CSV exported", `${rows.length} rows, 16 columns${counts.error ? `, ${counts.error} unresolved errors` : ""}`);
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
            <CardHeader title="Generator CSV" description={`Exact 16 column layout · ${rows.length} rows · ${includeBom ? "UTF-8 with BOM" : "UTF-8 without BOM"} · CRLF line endings`}
              actions={<Button variant="primary" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" />Export CSV</Button>} />
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
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setStatus(inspection.id, "Needs Review"); toast("Sent for review"); }} disabled={inspection.status === "Needs Review"}>Submit for review</Button>
                <Button variant="primary" disabled={counts.error > 0 || inspection.status === "Approved"} onClick={() => { setStatus(inspection.id, "Approved", `${counts.warning} warnings acknowledged`); toast("Inspection approved"); }}>
                  <CheckCircle2 className="h-4 w-4" />Approve
                </Button>
              </div>
              <p className="text-xs text-slate-500">Finished PDF report generation is not connected yet. It will be enabled only after your existing Generator is integrated and verified.</p>
            </CardBody>
          </Card>

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
