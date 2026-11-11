"use client";

import { create } from "zustand";
import { CheckCircle2, AlertTriangle } from "lucide-react";

interface ToastItem { id: number; message: string; tone: "success" | "error" }
interface ToastState { items: ToastItem[]; push(message: string, tone?: ToastItem["tone"]): void }

export const useToast = create<ToastState>((set) => ({
  items: [],
  push(message, tone = "success") {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, message, tone }].slice(-1) }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), tone === "error" ? 4000 : 2200);
  },
}));

export function toast(message: string, tone: ToastItem["tone"] = "success") {
  useToast.getState().push(message, tone);
}

export function Toaster() {
  const items = useToast((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-4 top-[calc(4rem+env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:items-end" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {t.tone === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
