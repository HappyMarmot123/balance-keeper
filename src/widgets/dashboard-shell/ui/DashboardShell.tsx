import type { ComponentChildren } from 'preact';

import { ThemeSwitch } from '../../../features/theme-switch';

type DashboardShellProps = {
  mapSlot: ComponentChildren;
  weatherSlot: ComponentChildren;
};

export function DashboardShell({ mapSlot, weatherSlot }: DashboardShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-foreground">
      <header className="border-b border-boundary bg-surface">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="font-data text-xs font-semibold tracking-widest text-accent">ATLAS ARMILLARY</p>
            <p className="mt-1 text-sm font-semibold">Balance Keeper</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="flex items-center gap-2 font-data text-xs text-muted">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              FOUNDATION READY
            </p>
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto grid w-full max-w-screen-2xl gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <h1 className="sr-only" id="app-title">
            Korea Monitor
          </h1>

          {mapSlot}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{weatherSlot}</div>
        </div>
      </main>

      <footer className="border-t border-boundary bg-surface px-4 py-4 text-center font-data text-xs text-muted">
        BALANCE KEEPER · ATLAS FOUNDATION · SEOUL DATUM
      </footer>
    </div>
  );
}
