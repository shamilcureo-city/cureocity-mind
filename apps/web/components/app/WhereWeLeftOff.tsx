import Link from 'next/link';
import type { SessionKind } from '@cureocity/contracts';
import { Badge } from '@/components/ui/Badge';
import type { CaseThread } from '@/lib/case-thread';

/**
 * Sprint 73 — the "previous part" recap. Pinned to the top of a
 * session's Notes tab so the document reads as a continuation, not an
 * island: last session's one-line recap (linked), the current working
 * diagnosis, the open threads of the work, and — crucially — any
 * risk that carried over from the last note.
 *
 * All values are composed deterministically by `computeCaseThread`
 * (no LLM), so this is safe to render on the clinical surface.
 * Server component — pure Links + text.
 */
export function WhereWeLeftOff({
  thread,
  currentKind,
}: {
  thread: CaseThread;
  currentKind: SessionKind;
}) {
  if (thread.isFirstSession || !thread.previous) {
    return <FirstSessionFrame kind={currentKind} />;
  }
  const p = thread.previous;

  return (
    <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Where we left off
        </h3>
      </div>

      <Link
        href={`/app/sessions/${p.lastSession.id}?tab=notes`}
        className="group mt-3 -mx-3 block rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-[var(--color-line-soft)] hover:bg-[var(--color-surface-soft)]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-ink-3)]">
            Last session · {formatDate(p.lastSession.at)}
            {p.lastSession.modality ? ` · ${p.lastSession.modality}` : ''} · Session{' '}
            {p.lastSession.ordinal}
          </span>
          <span className="shrink-0 text-xs text-[var(--color-ink-3)] group-hover:text-[var(--color-accent)]">
            Open →
          </span>
        </div>
        {p.lastSession.recap ? (
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">
            {p.lastSession.recap}
            {!p.lastSession.signed && (
              <span className="ml-1 align-middle text-xs text-[var(--color-ink-3)]">(draft)</span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-ink-3)]">
            No written recap on the last note.
          </p>
        )}
      </Link>

      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
            Working diagnosis
          </dt>
          <dd className="mt-1 text-sm text-[var(--color-ink)]">
            {p.diagnosis ? (
              <>
                {p.diagnosis.label}{' '}
                <span className="text-[var(--color-ink-3)]">({p.diagnosis.code})</span>
              </>
            ) : (
              <span className="text-[var(--color-ink-3)]">Not yet confirmed</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
            Open threads
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {p.openThreads.length > 0 ? (
              p.openThreads.map((t) => (
                <Badge key={t} tone="muted">
                  {t}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-[var(--color-ink-3)]">None on the list</span>
            )}
          </dd>
        </div>
      </dl>

      {p.carryoverRisk && (
        <div className="mt-4 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
            <span aria-hidden="true">⚠</span> Carry-over risk · {p.carryoverRisk.severity}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink)]">
            {p.carryoverRisk.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FirstSessionFrame({ kind }: { kind: SessionKind }) {
  return (
    <section className="rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Start of the story
        </h3>
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        {kind === 'INTAKE'
          ? 'This is the intake — the first chapter that sets the baseline. Every later note threads back to here.'
          : 'This is the first recorded session for this client. Later notes will carry forward from here.'}
      </p>
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
