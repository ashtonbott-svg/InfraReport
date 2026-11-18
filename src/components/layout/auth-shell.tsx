import { LogoMark } from "./logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-start justify-center bg-slate-950 px-4 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))] sm:items-center sm:pt-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark className="h-14 w-14" />
          <div className="text-2xl font-semibold tracking-tight text-white">Infra<span className="text-thermal-400">Report</span></div>
          <div className="text-xs text-slate-400">Infinite Infrared LLC</div>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-xl">{children}</div>
      </div>
    </div>
  );
}
