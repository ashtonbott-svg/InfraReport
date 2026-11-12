"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { FileUp, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, Table, th } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { FacilityFormModal, LocationFormModal } from "@/components/forms/entity-forms";
import { toast } from "@/components/ui/toast";
import { useCustomers, useEquipment, useFacilities, useInspections, useLocations, useResults } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { EQUIPMENT_PRESETS, OTHER_EQUIPMENT_TYPE } from "@/lib/domain/constants";
import { defaultComponentForType, inferTypeFromName } from "@/lib/domain/rules";
import { formatDate } from "@/lib/format";
import type { Location } from "@/lib/domain/types";
import { locationLabel } from "@/lib/domain/csv";

export default function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const facility = useFacilities().find((f) => f.id === id);
  const customer = useCustomers().find((c) => c.id === facility?.customerId);
  const allLocations = useLocations();
  const allEquipment = useEquipment();
  const results = useResults();
  const inspections = useInspections().filter((i) => i.facilityId === id).sort((a, b) => b.date.localeCompare(a.date));
  const locations = useMemo(() => allLocations.filter((l) => l.facilityId === id).sort((a, b) => a.sortOrder - b.sortOrder), [allLocations, id]);
  const equipment = useMemo(() => allEquipment.filter((e) => e.facilityId === id).sort((a, b) => a.sortOrder - b.sortOrder), [allEquipment, id]);
  const { deleteLocation, updateEquipment, createEquipment } = useStore();

  const [editFac, setEditFac] = useState(false);
  const [locModal, setLocModal] = useState<{ open: boolean; location?: Location }>({ open: false });
  const [eqModal, setEqModal] = useState<{ open: boolean; locationId: string }>({ open: false, locationId: "" });
  const [eqForm, setEqForm] = useState({ name: "", type: "Panel", component: "Full Panel" });
  const [filter, setFilter] = useState("");

  if (!facility) return <EmptyState title="Facility not found" action={<Link href="/facilities"><Button>Back to facilities</Button></Link>} />;

  const openAddEq = (locationId: string) => { setEqForm({ name: "", type: "Panel", component: "Full Panel" }); setEqModal({ open: true, locationId }); };
  const saveEq = () => {
    if (!eqForm.name.trim() || !eqModal.locationId) return;
    createEquipment({ facilityId: facility.id, locationId: eqModal.locationId, name: eqForm.name.trim(), equipmentType: eqForm.type, defaultComponent: eqForm.component });
    toast("Equipment added to inventory");
    setEqModal({ open: false, locationId: "" });
  };
  const f = filter.trim().toLowerCase();

  return (
    <>
      <PageHeader
        eyebrow={<><Link href="/facilities" className="hover:underline">Facilities</Link> / <Link href={`/customers/${customer?.id}`} className="hover:underline">{customer?.name}</Link></>}
        title={facility.name}
        description={<span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[facility.address, facility.city, facility.state, facility.postalCode].filter(Boolean).join(", ") || "No address"}</span>}
        actions={<>
          <Button onClick={() => setEditFac(true)}><Pencil className="h-4 w-4" />Edit</Button>
          <Link href={`/facilities/${facility.id}/import`}><Button><FileUp className="h-4 w-4" />Import Equipment List</Button></Link>
          <Link href={`/inspections/new?customer=${facility.customerId}&facility=${facility.id}`}><Button variant="primary"><Plus className="h-4 w-4" />New Inspection</Button></Link>
        </>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Rooms & equipment inventory" description="Permanent records. New inspections can carry this list forward automatically."
            actions={<>
              <Input className="h-8 w-44" placeholder="Filter equipment" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <Button size="sm" onClick={() => setLocModal({ open: true })}><Plus className="h-3.5 w-3.5" />Add Room</Button>
            </>} />
          {locations.length === 0 ? <EmptyState title="No rooms yet" description="Add electrical rooms, areas, or buildings for this facility." action={<Button variant="primary" onClick={() => setLocModal({ open: true })}>Add Room</Button>} /> : (
            <div className="divide-y divide-slate-100">
              {locations.map((l) => {
                const items = equipment.filter((e) => e.locationId === l.id && (!f || e.name.toLowerCase().includes(f) || e.defaultComponent.toLowerCase().includes(f)));
                return (
                  <section key={l.id} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{locationLabel(l)}</h3>
                        {l.area ? <div className="text-xs text-slate-500">{l.area}</div> : null}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openAddEq(l.id)}><Plus className="h-3.5 w-3.5" />Equipment</Button>
                        <Button size="icon" variant="ghost" aria-label="Edit room" onClick={() => setLocModal({ open: true, location: l })}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Delete room" onClick={() => { if (!deleteLocation(l.id)) toast("Room has equipment or inspection history and cannot be deleted", "error"); else toast("Room deleted"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    {items.length === 0 ? <p className="text-xs text-slate-400">No equipment.</p> : (
                      <Table className="rounded-md border border-slate-100">
                        <thead><tr><th className={th}>Equipment</th><th className={th}>Type</th><th className={th}>Default component</th><th className={th}>Inspected</th><th className={th}>Status</th></tr></thead>
                        <tbody>
                          {items.map((e) => (
                            <tr key={e.id}>
                              <td className="border-b border-slate-100 px-1 py-1"><input className="grid-input font-medium" value={e.name} onChange={(ev) => updateEquipment(e.id, { name: ev.target.value })} aria-label="Equipment name" /></td>
                              <td className="border-b border-slate-100 px-3 py-1 text-xs">{e.equipmentType}</td>
                              <td className="border-b border-slate-100 px-1 py-1"><input className="grid-input" value={e.defaultComponent} onChange={(ev) => updateEquipment(e.id, { defaultComponent: ev.target.value })} aria-label="Default component" /></td>
                              <td className="border-b border-slate-100 px-3 py-1 text-xs tabular-nums">{results.filter((r) => r.equipmentId === e.id).length}×</td>
                              <td className="border-b border-slate-100 px-3 py-1">
                                <button onClick={() => updateEquipment(e.id, { active: !e.active })} title="Inactive equipment is not carried into new inspections">
                                  {e.active ? <Badge tone="green">Active</Badge> : <Badge>Retired</Badge>}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-xl font-semibold">{locations.length}</div><div className="text-xs text-slate-500">Rooms</div></div>
              <div><div className="text-xl font-semibold">{equipment.filter((e) => e.active).length}</div><div className="text-xs text-slate-500">Active items</div></div>
              <div><div className="text-xl font-semibold">{inspections.length}</div><div className="text-xs text-slate-500">Inspections</div></div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Inspections" />
            {inspections.length === 0 ? <CardBody className="text-sm text-slate-500">None yet.</CardBody> : (
              <ul className="divide-y divide-slate-100">
                {inspections.map((i) => (
                  <li key={i.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/inspections/${i.id}`} className="font-medium hover:text-thermal-700">{formatDate(i.date)}</Link>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {facility.notes ? <Card><CardHeader title="Site notes" /><CardBody className="text-sm text-slate-600">{facility.notes}</CardBody></Card> : null}
        </div>
      </div>

      <FacilityFormModal open={editFac} onClose={() => setEditFac(false)} facility={facility} />
      <LocationFormModal open={locModal.open} onClose={() => setLocModal({ open: false })} facilityId={facility.id} location={locModal.location} />
      <Modal open={eqModal.open} onClose={() => setEqModal({ open: false, locationId: "" })} title="Add equipment to inventory"
        footer={<><Button onClick={() => setEqModal({ open: false, locationId: "" })}>Cancel</Button><Button variant="primary" onClick={saveEq} disabled={!eqForm.name.trim()}>Add</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Equipment name *" className="sm:col-span-2" htmlFor="eq-name">
            <Input id="eq-name" autoFocus value={eqForm.name} placeholder="e.g. Panel P3"
              onChange={(e) => {
                const name = e.target.value;
                const t = inferTypeFromName(name);
                setEqForm((v) => (t && t !== v.type ? { name, type: t, component: defaultComponentForType(t) } : { ...v, name }));
              }}
              onKeyDown={(e) => e.key === "Enter" && saveEq()} />
          </Field>
          <Field label="Type" htmlFor="eq-type">
            <Select id="eq-type" value={eqForm.type} onChange={(e) => setEqForm({ ...eqForm, type: e.target.value, component: defaultComponentForType(e.target.value) || eqForm.component })}>
              {EQUIPMENT_PRESETS.map((p) => <option key={p.type}>{p.type}</option>)}
              <option>{OTHER_EQUIPMENT_TYPE}</option>
            </Select>
          </Field>
          <Field label="Default component" htmlFor="eq-comp"><Input id="eq-comp" value={eqForm.component} onChange={(e) => setEqForm({ ...eqForm, component: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
