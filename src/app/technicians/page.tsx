"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Copy, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, Smartphone, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/cloud/client";
import { refreshIdentity } from "@/lib/cloud/session";
import { useRole } from "@/lib/cloud/role";
import { formatDateTime } from "@/lib/format";

interface Device { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Person {
  userId: string; name: string; certification: string; role: "admin" | "technician"; active: boolean;
  pinSet: boolean; pinSetAt: string | null; lockedUntil: string | null; devices: Device[];
}

export default function TechniciansPage() {
  const { cloud, isAdmin } = useRole();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cert, setCert] = useState("Level I Thermographer");
  const [link, setLink] = useState<{ userId: string; url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setPeople((await api<{ people: Person[] }>("/api/admin/technicians")).people); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => {
    if (!cloud || !isAdmin) return;
    let alive = true;
    api<{ people: Person[] }>("/api/admin/technicians")
      .then((r) => { if (alive) setPeople(r.people); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Could not load"); });
    return () => { alive = false; };
  }, [cloud, isAdmin]);

  if (!cloud) return <EmptyState title="Cloud accounts are not configured" description="Technician accounts need the shared database. This deployment saves data on this device only." />;
  if (!isAdmin) return <EmptyState title="Administrators only" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
  };
  const showLink = (userId: string, r: { token: string; expiresAt: string }) =>
    setLink({ userId, url: `${window.location.origin}/activate#t=${r.token}`, expiresAt: r.expiresAt });

  const create = () => run(async () => {
    const { userId } = await api<{ userId: string }>("/api/admin/technicians", { method: "POST", json: { name, certification: cert } });
    const r = await api<{ token: string; expiresAt: string }>(`/api/admin/technicians/${userId}/activation`, { method: "POST", json: { hours: 24 } });
    showLink(userId, r);
    setName("");
    toast("Technician created");
    await Promise.all([load(), refreshIdentity()]);
  });
  const activation = (p: Person) => run(async () => {
    showLink(p.userId, await api(`/api/admin/technicians/${p.userId}/activation`, { method: "POST", json: { hours: 24 } }));
    await load();
  });
  const resetPin = (p: Person) => run(async () => {
    if (!confirm(`Reset ${p.name}'s PIN? Every phone they use is signed out and they need a new activation link.`)) return;
    showLink(p.userId, await api(`/api/admin/technicians/${p.userId}/reset-pin`, { method: "POST" }));
    toast("PIN reset. Give them the new link and the temporary PIN.");
    await load();
  });
  const setActive = (p: Person, active: boolean) => run(async () => {
    if (!active && !confirm(`Disable ${p.name}? They are signed out everywhere and cannot sign in until you enable them again. Their inspection data is kept.`)) return;
    await api(`/api/admin/technicians/${p.userId}`, { method: "PATCH", json: { active } });
    toast(active ? "Account enabled" : "Account disabled");
    await Promise.all([load(), refreshIdentity()]);
  });
  const revoke = (d: Device) => run(async () => {
    if (!confirm("Revoke this phone? It will need a new activation link to sign in again.")) return;
    await api(`/api/admin/devices/${d.id}`, { method: "DELETE" });
    toast("Phone revoked");
    await load();
  });

  return (
    <>
      <PageHeader title="Technicians" description="Create technician accounts, activate their phones and manage PINs. Technicians only see inspections they are assigned to." />
      {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {link ? (
        <Card className="mb-6 border-thermal-300">
          <CardHeader title="Activation link" description={`Single use. Expires ${formatDateTime(link.expiresAt)}.`} actions={<Button size="sm" variant="ghost" onClick={() => setLink(null)}>Done</Button>} />
          <CardBody className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>Send this link to the technician by text message. They open it <strong>on their own phone</strong>.</li>
              <li>Tell them the temporary PIN <strong>12345</strong> separately (in person or by phone). It only works together with this link.</li>
              <li>They choose a personal PIN. After that the phone signs in with name and PIN.</li>
            </ol>
            <div className="flex gap-2">
              <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => toast("Link copied")); }}><Copy className="h-4 w-4" />Copy</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader title="Add technician" />
        <CardBody className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name" htmlFor="tn"><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Justice Thompson" /></Field>
          <Field label="Certification" htmlFor="tc"><Input id="tc" value={cert} onChange={(e) => setCert(e.target.value)} /></Field>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={create}><Plus className="h-4 w-4" />Create and get link</Button>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {people === null ? <p className="text-sm text-slate-500">Loading…</p> : people.map((p) => {
          const locked = p.lockedUntil && new Date(p.lockedUntil) > new Date();
          const devices = p.devices.filter((d) => !d.revoked_at);
          return (
            <Card key={p.userId}>
              <CardHeader
                title={<span className="flex flex-wrap items-center gap-2">{p.name}
                  {p.role === "admin" ? <Badge tone="violet"><ShieldCheck className="h-3 w-3" />Administrator</Badge> : <Badge>Technician</Badge>}
                  {!p.active ? <Badge tone="red">Disabled</Badge> : null}
                  {locked ? <Badge tone="amber">Locked until {new Date(p.lockedUntil!).toLocaleTimeString("en-US")}</Badge> : null}
                </span>}
                description={p.certification}
                actions={p.role === "technician" ? <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={busy || !p.active} onClick={() => activation(p)}><Link2 className="h-3.5 w-3.5" />Activate a phone</Button>
                  <Button size="sm" disabled={busy || !p.active} onClick={() => resetPin(p)}><KeyRound className="h-3.5 w-3.5" />Reset PIN</Button>
                  {p.active
                    ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setActive(p, false)}><Ban className="h-3.5 w-3.5" />Disable</Button>
                    : <Button size="sm" disabled={busy} onClick={() => setActive(p, true)}><UserCheck className="h-3.5 w-3.5" />Enable</Button>}
                </div> : null}
              />
              {p.role === "technician" ? (
                <CardBody className="space-y-2 text-sm">
                  <div className="text-slate-600">{p.pinSet ? `Personal PIN set ${p.pinSetAt ? formatDateTime(p.pinSetAt) : ""}` : "No personal PIN yet (waiting for activation)"}</div>
                  {devices.length ? (
                    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                      {devices.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                          <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs text-slate-700">{d.label || "Phone"}</div>
                            <div className="text-[11px] text-slate-400">Activated {formatDateTime(d.created_at)}{d.last_used_at ? ` · last sign-in ${formatDateTime(d.last_used_at)}` : ""}</div>
                          </div>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => revoke(d)}>Revoke</Button>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="text-xs text-slate-400">No activated phones.</div>}
                </CardBody>
              ) : null}
            </Card>
          );
        })}
      </div>
      <div className="mt-6"><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button></div>
    </>
  );
}
