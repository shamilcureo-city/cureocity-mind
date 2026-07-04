import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { InlineExplainer } from './EduHeading';
import { glossary } from '../../lib/clinical-glossary';
import { confidenceHint } from '../../lib/instrument-plain-language';

export interface DiagnosisHistoryRow {
  id: string;
  icd11Code: string;
  icd11Label: string;
  confidence: number;
  isPrimary: boolean;
  confirmedAt: Date;
  supersededAt: Date | null;
}

interface Props {
  diagnoses: DiagnosisHistoryRow[];
}

/**
 * Sprint 21 — Diagnosis history on the client / formulation surface.
 * Sprint 73 — rendered as a vertical timeline so the therapist can see
 * at a glance HOW the formulation evolved, not just a flat list.
 *
 * Cumulative ClientDiagnosis rows accumulate as the therapist confirms
 * diagnoses across sessions. This threads them into a single arc:
 * current (non-superseded) at the top with an accent node, the earlier
 * superseded diagnoses trailing below with the date each was replaced.
 * Read-only — diagnoses are confirmed from the Clinical Brief.
 */
export function DiagnosisHistoryCard({ diagnoses }: Props) {
  if (diagnoses.length === 0) return null;

  // Reverse-chronological: the current diagnosis leads, its lineage
  // trails below (most useful ordering — "where we are, and how we got here").
  const ordered = [...diagnoses].sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime());
  const changes = ordered.length - 1;

  return (
    <Card className="overflow-hidden">
      <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg">{glossary('diagnosisHistory').plainTitle}</h2>
          {changes > 0 && (
            <span className="text-xs text-[var(--color-ink-3)]">
              {changes} revision{changes === 1 ? '' : 's'} over time
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          The diagnoses you&apos;ve confirmed for this client, threaded over time.
        </p>
        <div className="mt-2">
          <InlineExplainer entry={glossary('diagnosisHistory')} />
        </div>
      </header>

      <div className="px-5 py-5">
        <ol>
          {ordered.map((d, i) => (
            <TimelineNode key={d.id} d={d} last={i === ordered.length - 1} />
          ))}
        </ol>
      </div>
    </Card>
  );
}

function TimelineNode({ d, last }: { d: DiagnosisHistoryRow; last: boolean }) {
  const current = d.supersededAt === null;

  return (
    <li className="flex gap-3">
      {/* Rail: node dot + connecting line down to the next entry. */}
      <div className="flex flex-col items-center" aria-hidden="true">
        <span
          className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${
            current
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] shadow-[0_0_0_4px_var(--color-accent-soft)]'
              : 'border-[var(--color-line)] bg-[var(--color-surface)]'
          }`}
        />
        {!last && <span className="w-px flex-1 bg-[var(--color-line)]" />}
      </div>

      <div className={`min-w-0 flex-1 ${last ? 'pb-0' : 'pb-6'}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-sm">
            <span className="font-mono text-[var(--color-ink)]">{d.icd11Code}</span>{' '}
            <span className={current ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-2)]'}>
              {d.icd11Label}
            </span>
          </p>
          {current && d.isPrimary && <Badge tone="accent">primary</Badge>}
          {current && !d.isPrimary && <Badge tone="muted">current</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
          {current ? 'Confirmed' : 'Was active'} {formatDate(d.confirmedAt)}
          {d.supersededAt && ` · replaced ${formatDate(d.supersededAt)}`}
          {' · '}
          <span title={confidenceHint}>confidence {(d.confidence * 100).toFixed(0)}%</span>
        </p>
      </div>
    </li>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}
