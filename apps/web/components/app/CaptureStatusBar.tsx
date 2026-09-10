import type { ReactNode } from 'react';

/** Presentation only: safe to use in the fictional preview without media hooks. */
export function CaptureStatusBar({
  status,
  elapsedMs,
  detail,
  children,
}: {
  status: string;
  elapsedMs: number;
  detail: string;
  children: ReactNode;
}) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <section
      aria-label="Recording controls"
      className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4"
    >
      <div className="min-w-0">
        <p className="font-medium" role="status">
          {status}
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          <span className="tabular-nums">{time}</span> <span>in this view · includes breaks</span>
        </p>
        <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-2)]">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
