'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MindCareRecordResponseSchema, type MindCareRecordDto } from '@cureocity/contracts';
import { sessionWorkPreparation, formatMindWorkDate } from '@/lib/mind-session-work';

/** Dated clinician-authored context only. Reading this never sends context to a model. */
export function MindCareContinuitySummary({ clientId }: { clientId: string }) {
  const [record, setRecord] = useState<MindCareRecordDto | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setStatus('loading');
    void fetch(`/api/v1/clients/${clientId}/care-record`, {
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
      .then(async (response) => {
        const parsed = MindCareRecordResponseSchema.safeParse(await response.json());
        if (
          !response.ok ||
          !parsed.success ||
          (parsed.data.record && parsed.data.record.clientId !== clientId)
        )
          throw new Error('Care context unavailable');
        if (!controller.signal.aborted) {
          setRecord(parsed.data.record);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [clientId, retry]);

  // Effects run after render: never project the previous client's record during a prop switch.
  if (status === 'loading' || (record !== null && record.clientId !== clientId))
    return (
      <p role="status" className="text-xs text-[var(--color-ink-3)]">
        Checking clinician-recorded session work…
      </p>
    );
  if (status === 'error')
    return (
      <p role="alert" className="text-xs text-[var(--color-warn)]">
        Saved session work could not be checked. It is not being treated as empty.
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="ml-2 underline"
        >
          Retry care context
        </button>
      </p>
    );
  const work = sessionWorkPreparation(record);
  if (!work) return null;
  return (
    <details className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Clinician-confirmed work to carry forward
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-xs text-[var(--color-ink-3)]">
          Source visit scheduled for {formatMindWorkDate(work.scheduledAt)}. This is the current
          care record’s work entry, not necessarily the latest visit.
        </p>
        <p className="font-medium">{work.disposition}</p>
        <p className="whitespace-pre-wrap leading-relaxed">{work.workDone}</p>
        <p className="whitespace-pre-wrap leading-relaxed">
          Client response: {work.clientResponse}
        </p>
        <p className="text-xs text-[var(--color-ink-3)]">
          Care record version {work.recordVersion} saved {formatMindWorkDate(work.recordSavedAt)}.
          Historical context is not evidence of today’s response or progress. It has not been sent
          to live AI.
        </p>
        <Link href={work.sourceHref} className="text-[var(--color-accent)] underline">
          Open source visit
        </Link>
      </div>
    </details>
  );
}
