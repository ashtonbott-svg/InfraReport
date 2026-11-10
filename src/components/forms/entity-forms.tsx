"use client";

import { useState, type FormEvent } from "react";
import { useOnOpen } from "@/lib/use-draft";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/lib/store/store";
import { useCustomers } from "@/lib/store/hooks";
import type { Customer, Facility, Location } from "@/lib/domain/types";

const emptyCustomer = { name: "", contactName: "", contactEmail: "", contactPhone: "", notes: "" };

export function CustomerFormModal({ open, onClose, customer, onSaved }: {
  open: boolean; onClose: () => void; customer?: Customer; onSaved?: (id: string) => void;
}) {
  const createCustomer = useStore((s) => s.createCustomer);
  const updateCustomer = useStore((s) => s.updateCustomer);
  const init = () => (customer ? { name: customer.name, contactName: customer.contactName, contactEmail: customer.contactEmail, contactPhone: customer.contactPhone, notes: customer.notes } : emptyCustomer);
  const [v, setV] = useState(init);
  useOnOpen(open, () => setV(init()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return;
    if (customer) {
      updateCustomer(customer.id, { ...v, name: v.name.trim() });
      toast("Customer updated");
      onSaved?.(customer.id);
    } else {
      const id = createCustomer({ ...v, name: v.name.trim() });
      toast("Customer created");
      onSaved?.(id);
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={customer ? "Edit customer" : "New customer"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="customer-form" disabled={!v.name.trim()}>{customer ? "Save changes" : "Create customer"}</Button></>}>
      <form id="customer-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name *" className="sm:col-span-2" htmlFor="c-name"><Input id="c-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Example Manufacturing" /></Field>
        <Field label="Primary contact" htmlFor="c-contact"><Input id="c-contact" value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="c-phone"><Input id="c-phone" value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} /></Field>
        <Field label="Email" className="sm:col-span-2" htmlFor="c-email"><Input id="c-email" type="email" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-2" htmlFor="c-notes"><Textarea id="c-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

const emptyFacility = { customerId: "", name: "", address: "", city: "", state: "", postalCode: "", notes: "" };

export function FacilityFormModal({ open, onClose, facility, customerId, onSaved }: {
  open: boolean; onClose: () => void; facility?: Facility; customerId?: string; onSaved?: (id: string) => void;
}) {
  const customers = useCustomers();
  const createFacility = useStore((s) => s.createFacility);
  const updateFacility = useStore((s) => s.updateFacility);
  const init = () => (facility
    ? { customerId: facility.customerId, name: facility.name, address: facility.address, city: facility.city, state: facility.state, postalCode: facility.postalCode, notes: facility.notes }
    : { ...emptyFacility, customerId: customerId ?? "" });
  const [v, setV] = useState(init);
  useOnOpen(open, () => setV(init()));

  const valid = v.name.trim() && v.customerId;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (facility) {
      updateFacility(facility.id, { ...v, name: v.name.trim() });
      toast("Facility updated");
      onSaved?.(facility.id);
    } else {
      const id = createFacility({ ...v, name: v.name.trim() });
      toast("Facility created");
      onSaved?.(id);
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={facility ? "Edit facility" : "New facility"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="facility-form" disabled={!valid}>{facility ? "Save changes" : "Create facility"}</Button></>}>
      <form id="facility-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
        <Field label="Customer *" className="sm:col-span-6" htmlFor="f-cust">
          <Select id="f-cust" value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value })}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Facility name *" className="sm:col-span-6" htmlFor="f-name"><Input id="f-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Plant 1, Main Campus" /></Field>
        <Field label="Street address" className="sm:col-span-6" htmlFor="f-addr"><Input id="f-addr" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="City" className="sm:col-span-3" htmlFor="f-city"><Input id="f-city" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field>
        <Field label="State" className="sm:col-span-1" htmlFor="f-state"><Input id="f-state" value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })} /></Field>
        <Field label="ZIP" className="sm:col-span-2" htmlFor="f-zip"><Input id="f-zip" value={v.postalCode} onChange={(e) => setV({ ...v, postalCode: e.target.value })} /></Field>
        <Field label="Notes (access, escorts, keys)" className="sm:col-span-6" htmlFor="f-notes"><Textarea id="f-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

export function LocationFormModal({ open, onClose, facilityId, location, onSubmit, title, children }: {
  open: boolean; onClose: () => void; facilityId?: string; location?: Location;
  onSubmit?: (v: { building: string; name: string; area: string }) => void; title?: string; children?: React.ReactNode;
}) {
  const createLocation = useStore((s) => s.createLocation);
  const updateLocation = useStore((s) => s.updateLocation);
  const init = () => (location ? { building: location.building, name: location.name, area: location.area } : { building: "", name: "", area: "" });
  const [v, setV] = useState(init);
  useOnOpen(open, () => setV(init()));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return;
    const clean = { building: v.building.trim(), name: v.name.trim(), area: v.area.trim() };
    if (onSubmit) onSubmit(clean);
    else if (location) { updateLocation(location.id, clean); toast("Room updated"); }
    else if (facilityId) { createLocation({ facilityId, ...clean }); toast("Room added"); }
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={title ?? (location ? "Edit room / location" : "Add room / location")}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="loc-form" disabled={!v.name.trim()}>Save</Button></>}>
      <form id="loc-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Room / location name *" className="sm:col-span-2" htmlFor="l-name"><Input id="l-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Electrical Room 1" /></Field>
        <Field label="Building" htmlFor="l-bldg" hint="Optional. Exported as “Building - Room”."><Input id="l-bldg" value={v.building} onChange={(e) => setV({ ...v, building: e.target.value })} placeholder="e.g. Building A" /></Field>
        <Field label="Electrical area / floor" htmlFor="l-area"><Input id="l-area" value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })} placeholder="e.g. Mezzanine" /></Field>
        {children ? <div className="sm:col-span-2">{children}</div> : null}
      </form>
    </Modal>
  );
}
