"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { adoptSession } from "@/lib/cloud/session";
import { AuthShell as Shell } from "@/components/layout/auth-shell";

let captured: string | null = null;
/** Reads the token once, then removes it from the address bar and history. */
function readToken(): string {
  if (captured === null) {
    const m = /(?:^|&)t=([A-Za-z0-9_-]+)/.exec(window.location.hash.slice(1));
    captured = m?.[1] ?? "";
    if (m) history.replaceState(null, "", "/activate");
  }
  return captured;
}
const noSubscribe = () => () => undefined;

/** First sign-in on a phone. The activation token travels in the URL fragment, which is never sent to servers or logs. */
export default function ActivatePage() {
  const router = useRouter();
  const token = useSyncExternalStore(noSubscribe, readToken, () => null);
  const [tempPin, setTempPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);


  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { if (tempPin.length >= 5) setStep(2); return; }
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/tech/activate", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, tempPin, newPin, confirmPin, label: navigator.userAgent.slice(0, 80) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.code === "temp_pin_wrong") { setStep(1); setTempPin(""); }
        throw new Error(body.error ?? "Activation failed");
      }
      await adoptSession(body.session);
      router.replace("/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
    } finally { setBusy(false); }
  };

  if (token === null) return <Shell><p className="text-sm text-slate-500">Loading…</p></Shell>;
  if (!token) return <Shell><p className="text-sm text-slate-600">This page needs the activation link from your administrator. Open the full link on this phone.</p></Shell>;

  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Activate this phone</h1>
      <p className="mb-4 text-sm text-slate-500">{step === 1 ? "Enter the temporary PIN your administrator gave you." : "Now choose your personal PIN. 6 digits is recommended."}</p>
      <form onSubmit={submit} className="space-y-4">
        {step === 1 ? (
          <Field label="Temporary PIN" htmlFor="temp">
            <Input id="temp" type="password" inputMode="numeric" autoComplete="one-time-code" value={tempPin} onChange={(e) => setTempPin(digits(e.target.value))} className="h-12 text-center text-2xl tracking-[0.5em]" />
          </Field>
        ) : (
          <>
            <Field label="New PIN (4 to 6 digits)" htmlFor="new">
              <Input id="new" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} className="h-12 text-center text-2xl tracking-[0.5em]" />
            </Field>
            <Field label="Confirm new PIN" htmlFor="confirm">
              <Input id="confirm" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} className="h-12 text-center text-2xl tracking-[0.5em]" />
            </Field>
            {confirmPin && newPin !== confirmPin ? <p className="text-xs text-red-600">The PINs do not match.</p> : null}
          </>
        )}
        <Button type="submit" variant="primary" size="lg" className="h-12 w-full justify-center text-base"
          disabled={busy || (step === 1 ? tempPin.length < 5 : newPin.length < 4 || newPin !== confirmPin)}>
          {step === 1 ? "Continue" : busy ? "Activating…" : "Set PIN and Sign In"}
        </Button>
      </form>
      {error ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    </Shell>
  );
}
