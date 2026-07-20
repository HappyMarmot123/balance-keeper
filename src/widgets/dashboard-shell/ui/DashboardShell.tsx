export function DashboardShell() {
  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 px-6 text-zinc-100">
      <section aria-labelledby="app-title" className="grid max-w-xl gap-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Foundation</p>
        <h1 id="app-title" className="text-3xl font-semibold tracking-tight">
          Korea Monitor
        </h1>
        <p className="text-sm text-zinc-400">프로젝트 기반 설정이 완료되었습니다.</p>
      </section>
    </main>
  );
}
