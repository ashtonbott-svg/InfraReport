"use client";

import Link from "next/link";
import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { CustomerFormModal, FacilityFormModal } from "@/components/forms/entity-forms";
import { toast } from "@/components/ui/toast";
import { useCustomers, useEquipment, useFacilities, useInspections, useLocations, useUsers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { formatDate, plural, todayISO } from "@/lib/format";

function NewInspectionForm() {
  const params = useSearchParams();
  const router = useRouter();
  const customers = useCustomers();
  const facilities = useFacilities();
  const equipment = useEquipment();
  const locations = useLocations();
  const inspections = useInspections();
  const users = useUsers();
  const currentUserId = useStore((s) => s.currentUserId);
  const createInspection = useStore((s) => s.createInspection);

  const [customerId, setCustomerId] = useState(params.get("customer") ?? "");
  const [facilityChoice, setFacilityId] = useState(params.get("facility") ?? "");
  const [date, setDate] = useState(todayISO());
  const [inspectorId, setInspectorId] = useState(currentUserId);
  const [carryForward, setCarryForward] = useState(true);
  const [notes, setNotes] = useState("");
  const [newCust, setNewCust] = useState(false);
  const [newFac, setNewFac] = useState(false);

  const custFacilities = useMemo(() => facilities.filter((f) => f.customerId === customerId), [facilities, customerId]);
  // A facility must belong to the chosen customer; auto-pick when there is only one.
  const facilityId = custFacilities.some((f) => f.id === facilityChoice) ? facilityChoice : custFacilities.length === 1 ? custFacilities[0].id : "";

  const eqCount = equipment.filter((e) => e.facilityId === facilityId && e.active).length;
  const roomCount = locations.filter((l) => l.facilityId === facilityId).length;
  const last = inspections.filter((i) => i.facilityId === facilityId).sort((a, b) => b.date.localeCompare(a.date))[0];
  const valid = customerId && facilityId && date && inspectorId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const id = createInspection({ customerId, facilityId, date, inspectorId, carryForward: carryForward && eqCount + roomCount > 0, notes });
    toast("Inspection created");
    router.push(`/inspections/${id}/entry`);
  };

  return (
    <>
      <PageHeader eyebrow={<Link href="/inspections" className="hover:underline">Inspections</Link>} title="New inspection" description="Choose an existing customer and facility, or create them here." />
      <form onSubmit={submit} className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Inspection details" />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="Customer *" className="sm:col-span-2" htmlFor="ni-cust">
              <div className="flex gap-2">
                <Select id="ni-cust" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setFacilityId(""); }}>
                  <option value="">Select customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button onClick={() => setNewCust(true)}><Plus className="h-4 w-4" />New</Button>
              </div>
            </Field>
            <Field label="Facility *" className="sm:col-span-2" htmlFor="ni-fac">
              <div className="flex gap-2">
                <Select id="ni-fac" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={!customerId}>
                  <option value="">{customerId ? "Select facility…" : "Select a customer first"}</option>
                  {custFacilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
                <Button onClick={() => setNewFac(true)} disabled={!customerId}><Plus className="h-4 w-4" />New</Button>
              </div>
            </Field>
            <Field label="Inspection date *" htmlFor="ni-date"><Input id="ni-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Inspector *" htmlFor="ni-insp">
              <Select id="ni-insp" value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.certification ? ` (${u.certification})` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2" htmlFor="ni-notes"><Textarea id="ni-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, contacts on site, special conditions" /></Field>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Equipment list" />
            <CardBody className="space-y-3 text-sm">
              {!facilityId ? <p className="text-slate-500">Select a facility to see its inventory.</p> : eqCount + roomCount === 0 ? (
                <p className="text-slate-500">This facility has no rooms or equipment yet. You will add them during entry.</p>
              ) : (
                <>
                  <p className="text-slate-600">This facility has <strong>{plural(roomCount, "room")}</strong> and <strong>{plural(eqCount, "active equipment item")}</strong>{last ? <> from the {formatDate(last.date)} inspection and earlier</> : null}.</p>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-thermal-600" checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)} />
                    <span><span className="font-medium text-slate-900">Carry forward equipment list</span><br /><span className="text-xs text-slate-500">Creates a blank result row for every active item. Temperatures, image numbers, and findings are never copied.</span></span>
                  </label>
                </>
              )}
            </CardBody>
          </Card>
          <Button variant="primary" size="lg" type="submit" className="w-full justify-center" disabled={!valid}>Create & start entry<ArrowRight className="h-4 w-4" /></Button>
        </div>
      </form>
      <CustomerFormModal open={newCust} onClose={() => setNewCust(false)} onSaved={(id) => { setCustomerId(id); setFacilityId(""); }} />
      <FacilityFormModal open={newFac} onClose={() => setNewFac(false)} customerId={customerId} onSaved={(id) => setFacilityId(id)} />
    </>
  );
}

export default function NewInspectionPage() {
  return <Suspense fallback={null}><NewInspectionForm /></Suspense>;
}
