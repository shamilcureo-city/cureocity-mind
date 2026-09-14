import type { MeterSummary } from '@cureocity/contracts';

/** Operational AI estimate, not the practitioner's subscription invoice. */
export function LiveCostEstimate({ summary }: { summary: MeterSummary }) {
  const breakdown = summary.costBreakdown;
  return (
    <div className="space-y-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
      <p className="font-medium text-[var(--color-ink)]">
        {summary.backend === 'mock' ? 'Simulated AI processing' : 'Estimated AI processing'}
        {' · '}₹{summary.costInr.toFixed(2)}
      </p>
      <p className="text-xs leading-relaxed">
        This connection only, not a per-minute price. This is not an invoice and does not determine
        your subscription charges.
      </p>
      {breakdown && (
        <dl className="space-y-1.5 text-sm">
          {[
            ['Transcription', breakdown.transcriptionInr],
            ['Note drafts', breakdown.notesInr],
            ['Live suggestions', breakdown.reasoningInr],
          ].map(([label, cost]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt>{label}</dt>
              <dd className="tabular-nums">₹{Number(cost).toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs leading-relaxed text-[var(--color-ink-3)]">
        Based on model usage, configured rates and a fixed currency estimate. Excludes other
        connections, follow-up AI and hosting. Actual provider billing may differ.
      </p>
    </div>
  );
}
