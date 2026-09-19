import Link from 'next/link';
import type { ClinicalDiagnosisCandidate } from '@cureocity/contracts';

type EvidenceFields = Pick<ClinicalDiagnosisCandidate, 'supportingEvidence' | 'gapsToFill'>;

export function diagnosisSuggestionEvidenceCounts(candidate: EvidenceFields) {
  const evidenceCount = candidate.supportingEvidence.length;
  const openQuestionCount = candidate.gapsToFill.length;

  return {
    evidenceCount,
    openQuestionCount,
    evidenceLabel: `${evidenceCount} transcript ${evidenceCount === 1 ? 'quote' : 'quotes'}`,
    openQuestionLabel:
      openQuestionCount === 0
        ? 'no AI-listed gaps'
        : `${openQuestionCount} open ${openQuestionCount === 1 ? 'question' : 'questions'}`,
  };
}

/**
 * A read-only evidence ledger for one AI diagnosis suggestion. It deliberately
 * omits the model's numeric confidence: that value is not diagnostic
 * probability or independently validated certainty. The clinician still owns
 * every select, dismiss and confirmation action in the parent board.
 */
export function DiagnosisSuggestionEvidence({
  candidate,
  sessionId,
}: {
  candidate: ClinicalDiagnosisCandidate;
  sessionId: string;
}) {
  const counts = diagnosisSuggestionEvidenceCounts(candidate);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <section
          aria-label="Evidence supplied for this diagnosis suggestion"
          className="rounded-xl border border-[var(--color-line-soft)] bg-white p-3.5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-ink)]">
              What supports this suggestion
            </h4>
            <span className="text-[11px] text-[var(--color-ink-3)]">{counts.evidenceLabel}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-3)]">
            AI-selected excerpts. Verify the speaker, wording and surrounding context.
          </p>
          <ul className="mt-3 space-y-3">
            {candidate.supportingEvidence.map((evidence, index) => (
              <li key={`${evidence.startMs}:${index}`}>
                <blockquote className="border-l-2 border-[var(--color-accent)] pl-3 text-[13px] italic leading-relaxed text-[var(--color-ink-2)]">
                  &ldquo;{evidence.quote}&rdquo;
                </blockquote>
                <p className="mt-1 pl-3 text-[11px] text-[var(--color-ink-3)] tabular-nums">
                  {speakerLabel(evidence.speaker)} · {formatEvidenceTimestamp(evidence.startMs)}
                </p>
              </li>
            ))}
          </ul>
          <Link
            href={`/app/sessions/${sessionId}?tab=transcript`}
            className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Review source transcript
          </Link>
        </section>

        <section
          aria-label="Uncertainty in this diagnosis suggestion"
          className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-3.5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-ink)]">What remains unknown</h4>
            <span className="text-[11px] text-[var(--color-ink-3)]">
              {counts.openQuestionLabel}
            </span>
          </div>
          {candidate.gapsToFill.length > 0 ? (
            <ul className="mt-3 list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
              {candidate.gapsToFill.map((gap, index) => (
                <li key={index}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
              The AI listed no missing criteria or questions. This does not mean diagnostic criteria
              are established.
            </p>
          )}
        </section>
      </div>

      <p
        role="note"
        className="rounded-lg border border-dashed border-[var(--color-line)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-3)]"
      >
        Working hypothesis only. The excerpts and open-question list can be incomplete; check the
        source and use your clinical assessment before adding anything to the record.
      </p>
    </div>
  );
}

export function formatEvidenceTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function speakerLabel(speaker: 'client' | 'therapist' | 'unknown'): string {
  if (speaker === 'client') return 'Client';
  if (speaker === 'therapist') return 'Psychologist';
  return 'Speaker not identified';
}
