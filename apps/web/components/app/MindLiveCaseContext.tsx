'use client';
import { useState } from 'react';
import type { TherapyApprovedCaseContext } from '@cureocity/contracts';
import { Button } from '../ui/Button';

export function MindLiveCaseContext({
  context,
  status,
  ready,
  onUse,
  onClear,
}: {
  context: TherapyApprovedCaseContext;
  status: 'off' | 'pending' | 'using' | 'unconfirmed';
  ready: boolean;
  onUse: () => void;
  onClear: () => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  return (
    <details className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-sm">
      <summary className="cursor-pointer font-medium">Case background for session support</summary>
      <p className="mt-3 text-[var(--color-ink-2)]">
        Optional. Review this snapshot from the clinical record before using it in live AI support.
        It is not evidence of what happened today.
      </p>
      {context.formulation && (
        <section className="mt-3">
          <h3 className="font-medium">
            Shared understanding · version {context.formulation.version}
          </h3>
          <p className="whitespace-pre-wrap">{context.formulation.narrative}</p>
        </section>
      )}
      <section className="mt-3">
        <h3 className="font-medium">Agreed goals</h3>
        {context.goals.length ? (
          <ul className="list-disc pl-5">
            {context.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        ) : (
          <p>No confirmed goals in this snapshot.</p>
        )}
      </section>
      <section className="mt-3">
        <h3 className="font-medium">Recorded diagnostic status</h3>
        <p>
          {context.diagnoses.map((d) => `${d.label} (${d.code})`).join('; ') ||
            'No working diagnosis recorded. Counselling can continue without one.'}
        </p>
      </section>
      {context.measures.length > 0 && (
        <section className="mt-3">
          <h3 className="font-medium">Previous measures, not today’s assessment</h3>
          {context.measures.map((m) => (
            <p key={m.instrument}>
              {m.instrument}: {m.score} · {new Date(m.recordedAt).toLocaleDateString('en-IN')}
            </p>
          ))}
        </section>
      )}
      {context.guide && (
        <section className="mt-3">
          <h3 className="font-medium">Selected draft guide: {context.guide.name}</h3>
          <ul className="list-disc pl-5">
            {context.guide.purposes.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p>
            Check the full guide and watchpoints separately. This does not record an intervention as
            delivered.
          </p>
        </section>
      )}
      <label className="mt-4 flex items-start gap-3">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>I reviewed this background for relevance and suitability for today’s session.</span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={!reviewed || !ready || status === 'pending'} onClick={onUse}>
          Use reviewed background
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!ready || status === 'pending'}
          onClick={onClear}
        >
          Clear background
        </Button>
      </div>
      <p role="status" className="mt-2 text-[var(--color-ink-2)]">
        {!ready
          ? 'Connect the live session before sending background. Nothing has been sent by opening this panel.'
          : status === 'using'
            ? 'The gateway acknowledged this reviewed background. You remain in control of the session.'
            : status === 'pending'
              ? 'Waiting for gateway confirmation…'
              : status === 'unconfirmed'
                ? 'Background state is not confirmed. Retry or clear it; do not assume the latest snapshot is in use.'
                : 'This snapshot is not being used by live support.'}
      </p>
    </details>
  );
}
