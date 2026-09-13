/** The draft's stored estimate is not a whole-session ledger or a provider invoice. */
export function SavedNoteProcessingDetails({
  costInr,
  chunkCount,
  transcriptChars,
  region,
}: {
  costInr: string;
  chunkCount: number;
  transcriptChars: number;
  region: string;
}) {
  const amount = Number(costInr);
  // Legacy/live draft rows can default to zero without any cost receipt. Do not present
  // that as free processing. This display never changes stored usage or billing.
  const knownPositiveEstimate = costInr.trim() !== '' && Number.isFinite(amount) && amount > 0;
  return (
    <details className="mt-6 border-t border-[var(--color-line-soft)] pt-4 text-xs text-[var(--color-ink-3)] print:hidden">
      <summary className="cursor-pointer select-none font-medium text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]">
        Processing details
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Saved AI estimate"
          value={knownPositiveEstimate ? `₹${amount.toFixed(2)}` : 'Not available'}
        />
        <Stat label="Transcript turns" value={String(chunkCount)} />
        <Stat label="Characters" value={String(transcriptChars)} />
        <Stat label="Backend / state" value={region} />
      </dl>
      <p className="mt-3 leading-relaxed">
        This partial estimate was saved with the note. It may exclude live connections and other AI
        activity; it is not a whole-session bill or a per-minute price. Actual provider billing may
        differ. A missing or zero saved estimate does not establish free processing.
      </p>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[13px] text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
