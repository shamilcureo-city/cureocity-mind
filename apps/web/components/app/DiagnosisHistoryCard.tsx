import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

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
 * Sprint 21 — Diagnosis history card on the client detail page.
 *
 * Cumulative ClientDiagnosis rows accumulate as the therapist confirms
 * diagnoses across sessions, but until now had no dedicated view (only
 * the audit trail). This surfaces the current working diagnosis + the
 * superseded history so the therapist can see how the formulation
 * evolved. Read-only — diagnoses are confirmed from the Clinical Brief.
 */
export function DiagnosisHistoryCard({ diagnoses }: Props) {
  if (diagnoses.length === 0) return null;

  const active = diagnoses.filter((d) => d.supersededAt === null);
  const superseded = diagnoses.filter((d) => d.supersededAt !== null);

  return (
    <Card className="overflow-hidden">
      <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Diagnosis history
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Confirmed from the Clinical Brief and kept cumulatively.
        </p>
      </header>

      <div className="px-5 py-4">
        {active.length > 0 ? (
          <ul className="space-y-2">
            {active.map((d) => (
              <DiagnosisRow key={d.id} d={d} current />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-ink-3)]">
            No active diagnosis — only superseded entries remain.
          </p>
        )}

        {superseded.length > 0 && (
          <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Earlier (superseded)
            </p>
            <ul className="space-y-2">
              {superseded.map((d) => (
                <DiagnosisRow key={d.id} d={d} current={false} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function DiagnosisRow({ d, current }: { d: DiagnosisHistoryRow; current: boolean }) {
  return (
    <li
      className={`flex flex-wrap items-baseline justify-between gap-2 rounded-xl border px-4 py-3 ${
        current
          ? 'border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]'
          : 'border-[var(--color-line-soft)] opacity-70'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-mono text-[var(--color-ink)]">{d.icd11Code}</span>{' '}
          <span className="text-[var(--color-ink)]">{d.icd11Label}</span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
          {current ? 'Confirmed' : 'Was active'} {formatDate(d.confirmedAt)}
          {d.supersededAt && ` · replaced ${formatDate(d.supersededAt)}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {d.isPrimary && current && <Badge tone="accent">primary</Badge>}
        <Badge tone="muted">confidence {(d.confidence * 100).toFixed(0)}%</Badge>
      </div>
    </li>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
