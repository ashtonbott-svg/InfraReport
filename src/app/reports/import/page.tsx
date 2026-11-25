"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { ThermographerPicker } from "@/components/forms/thermographer-picker";
import { useRole } from "@/lib/cloud/role";
import { useCustomers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { groupGeneratorRows, mapOpened, parseGeneratorSheet, type GeneratorWorkbook } from "@/lib/reports/generator-import";

function splitAddress(a: string) {
  const m = a.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  return m ? { address: m[1], city: m[2], state: m[3], postalCode: m[4] } : { address: a, city: "", state: "", postalCode: "" };
}

export default function ImportGeneratorPage() {
  const router = useRouter();
  const { isAdmin, cloud } = useRole();
  const customers = useCustomers();
  const [book, setBook] = useState<GeneratorWorkbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [inspectorIds, setInspectorIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const rooms = useMemo(() => (book ? groupGeneratorRows(book.rows) : []), [book]);

  if (!isAdmin) return <EmptyState title="Administrators only" />;

  const read = async (file: File) => {
    setError(""); setBook(null);
    try {
      const { default: readXlsx } = await import("read-excel-file/universal");
      const sheets = (await readXlsx(file)) as { sheet: string; data: unknown[][] }[];
      const gen = sheets.find((s) => s.sheet === "Generator") ?? sheets.find((s) => s.data.some((r) => r.some((c) => c === "Finding_Number")));
      if (!gen) throw new Error("No Generator sheet found in this workbook.");
      const b = parseGeneratorSheet(gen.data);
      setBook(b); setFileName(file.name);
      setCustomerId(customers.find((c) => c.name.trim().toLowerCase() === b.client.toLowerCase())?.id ?? "new");
      setFacilityName(splitAddress(b.address).address || b.client);
    } catch (e) { setError((e as Error).message); }
  };

  const create = () => {
    if (!book) return;
    setBusy(true);
    const s = useStore.getState();
    const custId = customerId === "new" ? s.createCustomer({ name: book.client || "Imported customer", contactName: "", contactEmail: "", contactPhone: "", notes: "" }) : customerId;
    const facId = s.createFacility({ customerId: custId, name: facilityName.trim() || book.client, ...splitAddress(book.address), notes: `Created from ${fileName}` });
    const id = s.createInspection({ customerId: custId, facilityId: facId, date: book.date, inspectorIds, carryForward: false, notes: "" });
    s.logEvent(id, "Imported", `Created from Generator workbook ${fileName}: ${book.rows.length} rows`);
    for (const room of rooms) {
      const locId = s.createRoomForInspection(id, { building: "", name: room.name, area: "" }, { humidity: room.humidity, ambientTemp: room.ambient, backgroundTemp: room.background, imageDate: room.imageDate });
      for (const eq of room.equipment) {
        const [first, ...more] = eq.images;
        const resId = s.addResult(id, locId, {
          name: eq.name, equipmentType: "", component: first.component, irImageNumber: first.ir, visualImageNumber: first.visual,
          maxTemp: first.maxTemp, possibleCause: first.cause || undefined, distance: first.distance, opened: mapOpened(eq.opened).value,
        });
        if (eq.extra) s.updateResult(resId, { reviewNotes: eq.extra });
        for (const img of more) s.addThermalImage(resId, {
          component: img.component, irImageNumber: img.ir, visualImageNumber: img.visual, visualOverridden: !!img.visual && img.visual !== img.ir,
          maxTemp: img.maxTemp, possibleCause: img.cause || "NONE", distance: img.distance,
        });
      }
    }
    toast(`Inspection created from ${fileName}`);
    router.push(`/reports/${id}`);
  };

  const eqCount = rooms.reduce((n, r) => n + r.equipment.length, 0);
  return (
    <>
      <PageHeader eyebrow={<Link href="/reports" className="hover:underline">Reports</Link>} title="Import a Generator workbook"
        description="Creates a new inspection from the findings table of a Report Generator workbook so it can be reported here. The workbook is only read: macros are not run and the file is not changed." />
      {!cloud ? <p className="mb-4 text-sm text-amber-700">Not signed in to the cloud: the inspection will be saved on this device only.</p> : null}
      <Card className="max-w-4xl">
        <CardBody className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm hover:bg-slate-50">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <span>{fileName || "Choose the Generator workbook (.xlsm or .xlsx)"}</span>
            <input type="file" accept=".xlsm,.xlsx" className="sr-only" data-testid="generator-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {book ? (
            <>
              <p className="text-sm" data-testid="import-summary"><b>{book.client || "No client name"}</b>, {book.address || "no address"}, inspected {book.date || "date not found"}: {book.rows.length} rows, {rooms.length} locations, {eqCount} items of equipment.</p>
              {[...book.notes, ...rooms.flatMap((r) => r.equipment.flatMap((e) => (e.conflict ? [e.conflict] : [])))].length ? <ul className="space-y-1 text-sm text-amber-800">{[...book.notes, ...rooms.flatMap((r) => r.equipment.flatMap((e) => (e.conflict ? [e.conflict] : [])))].map((n, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{n}</li>)}</ul> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer" htmlFor="imp-cust">
                  <Select id="imp-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="new">New customer: {book.client || "Imported customer"}</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="New facility name" htmlFor="imp-fac"><Input id="imp-fac" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></Field>
                <Field label="Thermographers *" className="sm:col-span-2"><ThermographerPicker value={inspectorIds} onChange={setInspectorIds} /></Field>
              </div>
              <details className="text-sm"><summary className="cursor-pointer text-slate-600">Locations and equipment</summary>
                <ul className="mt-2 space-y-1">{rooms.map((r) => <li key={r.name}><b>{r.name}</b>: {r.equipment.map((e) => `${e.name} (${e.images.length})`).join(", ")}</li>)}</ul>
              </details>
              <Button variant="primary" disabled={busy || !book.date || inspectorIds.length === 0} onClick={create} data-testid="import-create">Create Inspection</Button>
              <p className="text-xs text-slate-500">Values are copied as written. Blank temperatures stay blank. Severity and recommendations are worked out by InfraReport from the readings, the same way the Generator does, and listed for review.</p>
            </>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
