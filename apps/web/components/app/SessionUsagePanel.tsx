'use client';

import { useEffect, useState } from 'react';
import { SessionUsageSummarySchema, type SessionUsageSummary } from '@cureocity/contracts';

const amount = (value: string | null) =>
  value === null
    ? 'Not recorded'
    : `₹${Number(value).toFixed(Number(value) > 0 && Number(value) < 0.01 ? 4 : 2)}`;

/** No costs are persisted in browser storage, and a previous visit's result is never shown. */
export function SessionUsagePanel({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<{ sessionId: string; data: SessionUsageSummary } | null>(
    null,
  );
  const [error, setError] = useState<{ sessionId: string; message: string } | null>(null);
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/usage`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('unavailable');
        const data = SessionUsageSummarySchema.parse(await response.json());
        if (data.sessionId !== sessionId) throw new Error('wrong visit');
        if (current) setResult({ sessionId, data });
      } catch {
        if (current)
          setError({
            sessionId,
            message:
              'The estimate could not be refreshed. Try again; missing usage does not mean free processing.',
          });
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [sessionId, request]);
  const data = result?.sessionId === sessionId ? result.data : null;
  return (
    <details className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5 print:hidden">
      <summary className="cursor-pointer rounded text-sm font-medium text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]">
        AI processing estimate
      </summary>
      <div className="mt-4 space-y-4">
        {error?.sessionId === sessionId && (
          <p role="status" className="max-w-prose text-sm text-[var(--color-warn,#815600)]">
            {error.message}
          </p>
        )}
        {loading && !data && (
          <p role="status" className="text-sm text-[var(--color-ink-2)]">
            Reading the recorded estimate…
          </p>
        )}
        {data && <SessionUsageDetails summary={data} stale={error?.sessionId === sessionId} />}
        <button
          type="button"
          onClick={() => setRequest((n) => n + 1)}
          disabled={loading}
          className="rounded-full border border-[var(--color-line-soft)] px-4 py-2 text-sm text-[var(--color-accent)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {loading ? 'Refreshing…' : 'Refresh estimate'}
        </button>
      </div>
    </details>
  );
}

export function SessionUsageDetails({
  summary,
  stale = false,
}: {
  summary: SessionUsageSummary;
  stale?: boolean;
}) {
  const connections = summary.connections;
  return (
    <div className="max-w-prose space-y-4 text-sm text-[var(--color-ink-2)]">
      <p className="font-medium text-[var(--color-ink)]">
        {stale
          ? 'Last available estimate: '
          : summary.lowerBound
            ? 'At least '
            : 'Recorded subtotal: '}
        {amount(summary.recordedSubtotalInr)}
      </p>
      <p>
        This is a partial AI processing estimate, not an invoice or a per-minute price. It does not
        determine your subscription charges.
      </p>
      <dl className="space-y-2">
        <UsageLine
          label={`Live connection receipts (${connections.receipted} of ${connections.registered})`}
          value={amount(summary.liveConnectionSubtotalInr)}
        />
        <UsageLine
          label={`Session-linked web calls (${summary.webCallRecords})`}
          value={amount(summary.webCallSubtotalInr)}
        />
        {summary.legacySubtotalInr !== null && (
          <UsageLine label="Older live estimate" value={amount(summary.legacySubtotalInr)} />
        )}
      </dl>
      {summary.lowerBound && (
        <p className="text-[var(--color-warn,#815600)]">
          The older and newer live figures may cover the same work. We include only the larger live
          subtotal, not both; this is a lower bound, not a reconciled total.
        </p>
      )}
      {summary.recordedSubtotalInr === '0.0000' && (
        <p>A zero receipt is recorded. This does not establish that all processing was free.</p>
      )}
      <details>
        <summary className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
          What this estimate covers
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">
          {summary.coverageReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed">
          Actual provider billing may differ. Missing receipts, unallocated activity and
          provider-side retries cannot be reconstructed here.
        </p>
      </details>
    </div>
  );
}

function UsageLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
