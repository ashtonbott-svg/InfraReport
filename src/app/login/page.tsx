"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { AuthShell as Shell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { adminSignIn, adoptSession, useSession } from "@/lib/cloud/session";
import { cloudConfigured } from "@/lib/cloud/client";

interface DeviceTech { userId: string; name: string; certification: string }

export default function LoginPage() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const sessionError = useSession((s) => s.error);
  const [mode, setMode] = useState<"tech" | "admin">("tech");
  const [techs, setTechs] = useState<DeviceTech[] | null>(null);
  const [techId, setTechId] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signedIn") router.replace(me?.role === "admin" ? "/" : "/jobs");
  }, [status, me, router]);

  useEffect(() => {
    if (!cloudConfigured) return;
    fetch("/api/tech/device", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((b: { technicians?: DeviceTech[] }) => {
        const list = b.technicians ?? [];
        setTechs(list);
        if (list.length === 1) setTechId(list[0].userId);
      })
      .catch(() => setTechs([]));
  }, []);

  if (!cloudConfigured) {
    return (
      <Shell>
        <p className="text-sm text-slate-600">Cloud sign-in is not configured for this deployment. This copy of InfraReport saves data on this device only.</p>
        <Link href="/"><Button variant="primary" className="mt-4 w-full justify-center">Open InfraReport</Button></Link>
      </Shell>
    );
  }

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/tech/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ userId: techId, pin }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Sign in failed");
      await adoptSession(body.session);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setPin("");
    } finally { setBusy(false); }
  };
  const submitAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await adminSignIn(email, password); setPassword(""); } catch (err) { setError(err instanceof Error ? err.message : "Sign in failed"); } finally { setBusy(false); }
  };

  return (
    <Shell>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {([["tech", "Technician Login", Smartphone], ["admin", "Administrator Login", ShieldCheck]] as const).map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
            className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-sm font-medium", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {mode === "tech" ? (
        techs === null ? <p className="py-6 text-center text-sm text-slate-500">Checking this phone…</p>
          : techs.length === 0 ? (
            <div className="space-y-3 text-sm text-slate-600">
              <p><strong>This phone is not activated yet.</strong></p>
              <p>Ask your administrator for an activation link. Open it on this phone, enter the temporary PIN they give you, then choose your own PIN.</p>
              <p className="text-xs text-slate-500">For security, a PIN only works on a phone that was activated with a link.</p>
            </div>
          ) : (
            <form onSubmit={submitPin} className="space-y-4">
              <Field label="Technician" htmlFor="tech">
                <div id="tech" className="grid gap-2">
                  {techs.map((t) => (
                    <button type="button" key={t.userId} onClick={() => setTechId(t.userId)}
                      className={cn("rounded-lg border px-3 py-3 text-left", techId === t.userId ? "border-thermal-500 bg-thermal-50 ring-1 ring-thermal-500" : "border-slate-200 bg-white")}>
                      <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.certification}</div>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="PIN" htmlFor="pin">
                <Input id="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4,6}" maxLength={6} value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="h-12 text-center text-2xl tracking-[0.5em]" />
              </Field>
              <Button type="submit" variant="primary" size="lg" className="h-12 w-full justify-center text-base" disabled={busy || !techId || pin.length < 4}>
                <KeyRound className="h-4 w-4" />{busy ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          )
      ) : (
        <form onSubmit={submitAdmin} className="space-y-4">
          <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-base" /></Field>
          <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 text-base" /></Field>
          <Button type="submit" variant="primary" size="lg" className="h-12 w-full justify-center text-base" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign In"}</Button>
        </form>
      )}
      {error || sessionError ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? sessionError}</p> : null}
    </Shell>
  );
}
