"use client";

import { useRef, useState } from "react";
import { Database, Download, Plus, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { useOrganization } from "@/lib/store/hooks";
import { useStore, SCHEMA_VERSION } from "@/lib/store/store";
import { BUILT_IN_POSSIBLE_CAUSES, OPENED_VALUES, STORAGE_KEY } from "@/lib/domain/constants";
import { GENERATOR_COLUMNS } from "@/lib/domain/csv";
import { downloadText } from "@/lib/download";
import { todayISO } from "@/lib/format";

export default function SettingsPage() {
  const org = useOrganization();
  const updateOrgSettings = useStore((s) => s.updateOrgSettings);
  const resetDemoData = useStore((s) => s.resetDemoData);
  const [cause, setCause] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!org) return null;
  const s = org.settings;

  const addCause = () => {
    const c = cause.trim();
    if (!c) return;
    if ([...BUILT_IN_POSSIBLE_CAUSES, ...s.customPossibleCauses].some((x) => x.toLowerCase() === c.toLowerCase())) { toast("That cause already exists", "error"); return; }
    updateOrgSettings({ customPossibleCauses: [...s.customPossibleCauses, c] });
    setCause("");
    toast("Possible cause added");
  };

  const backup = () => {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "{}";
    downloadText(`infrareport-demo-backup-${todayISO()}.json`, raw, "application/json");
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed?.state?.organizations) throw new Error("Not an InfraReport backup");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      await useStore.persist.rehydrate();
      toast("Backup restored");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Restore failed", "error");
    }
  };

  return (
    <>
      <PageHeader title="Settings" description={`${org.name}${org.isDemo ? " · demonstration organization" : ""}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Inspection defaults" />
          <CardBody className="space-y-4">
            <Field label="Default emissivity for new inspections" htmlFor="s-em" hint="0.95 unless you explicitly change it.">
              <Input id="s-em" className="max-w-32" inputMode="decimal" value={s.defaultEmissivity} onChange={(e) => updateOrgSettings({ defaultEmissivity: e.target.value })} />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-thermal-600" checked={s.csvIncludeBom} onChange={(e) => updateOrgSettings({ csvIncludeBom: e.target.checked })} />
              <span><span className="font-medium">Include UTF-8 byte order mark in CSV</span><br /><span className="text-xs text-slate-500">Recommended so Excel shows “Can’t Open Item” correctly. Turn off only if your Generator macro reads the first header cell incorrectly.</span></span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Possible causes" description="Controlled vocabulary. Built in values cannot be removed." />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {BUILT_IN_POSSIBLE_CAUSES.map((c) => <Badge key={c}>{c}</Badge>)}
              {s.customPossibleCauses.map((c) => (
                <Badge key={c} tone="orange">{c}<button aria-label={`Remove ${c}`} onClick={() => updateOrgSettings({ customPossibleCauses: s.customPossibleCauses.filter((x) => x !== c) })}><X className="h-3 w-3" /></button></Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Add a cause, e.g. Unbalanced Load" value={cause} onChange={(e) => setCause(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCause()} />
              <Button onClick={addCause}><Plus className="h-4 w-4" />Add</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Approved Opened values" description="Exported exactly as written." />
          <CardBody><ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{OPENED_VALUES.map((o) => <li key={o} className="font-mono text-xs">{o}</li>)}</ol></CardBody>
        </Card>

        <Card>
          <CardHeader title="Generator column map" />
          <CardBody className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {GENERATOR_COLUMNS.map((c, i) => (
              <div key={c.header} className="flex justify-between border-b border-slate-100 py-1"><span>{i + 1}. {c.header}</span><span className="font-mono text-slate-500">{c.excelColumn ?? "none"}</span></div>
            ))}
            <div className="col-span-2 pt-2 text-slate-500">Columns O, P, Q are Generator formulas and are never written.</div>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Prototype data storage" actions={<Badge tone="amber"><Database className="h-3 w-3" />Browser localStorage · schema v{SCHEMA_VERSION}</Badge>} />
          <CardBody className="space-y-4 text-sm text-slate-600">
            <p>Everything you enter is saved in this browser only. It is not encrypted, not backed up, not shared between devices, and not a secure database. Clearing site data erases it. Use fictional data only until authentication, a Postgres database with per organization isolation, and private file storage are in place.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={backup}><Download className="h-4 w-4" />Download JSON backup</Button>
              <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Restore backup</Button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ""; }} />
              <Button variant="danger" onClick={() => { if (confirm("Replace all data in this browser with the original demo data?")) { resetDemoData(); toast("Demo data restored"); } }}><RotateCcw className="h-4 w-4" />Reset demo data</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
