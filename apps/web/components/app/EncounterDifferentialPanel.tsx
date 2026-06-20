'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DifferentialResponseSchema,
  type CodingNudge,
  type DifferentialCandidate,
  type DifferentialDiagnosisV1,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

/**
 * Sprint DV6 — the differential-diagnosis panel (the reasoning copilot).
 *
 * Auto-runs once the note is ready: ranked candidates with ICD-10 +
 * likelihood + discriminating questions + suggested workup, red flags to
 * exclude, and ICD-10 coding nudges (🧾). Decision-support only — never
 * auto-applied to the note. See docs/DOCTOR_VERTICAL.md §6, §7.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'generating' }
  | { kind: 'done'; differential: DifferentialDiagnosisV1 }
  | { kind: 'failed'; message: string };

export function EncounterDifferentialPanel({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const triggered = useRef(false);

  const generate = useCallback(async () => {
    setState({ kind: 'generating' });
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/differential`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: 'failed', message: body.error ?? `Could not run (${res.status}).` });
        return;
      }
      applyResponse(await res.json());
    } catch (e) {
      setState({ kind: 'failed', message: (e as Error).message });
    }
  }, [sessionId]);

  const applyResponse = useCallback((raw: unknown) => {
    const parsed = DifferentialResponseSchema.safeParse(raw);
    if (!parsed.success) {
      setState({ kind: 'failed', message: 'The differential could not be read.' });
      return;
    }
    if (parsed.data.status === 'COMPLETED' && parsed.data.differential) {
      setState({ kind: 'done', differential: parsed.data.differential });
    } else if (parsed.data.status === 'FAILED') {
      setState({ kind: 'failed', message: parsed.data.errorMessage ?? 'Differential failed.' });
    } else {
      setState({ kind: 'generating' });
    }
  }, []);

  // On mount: read the existing differential; if none, generate once.
  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    void (async () => {
      const res = await fetch(`/api/v1/sessions/${sessionId}/differential`);
      if (res.status === 404) {
        void generate();
        return;
      }
      if (!res.ok) {
        setState({ kind: 'failed', message: `Could not load (${res.status}).` });
        return;
      }
      applyResponse(await res.json());
    })();
  }, [sessionId, generate, applyResponse]);

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl">Differential · reasoning copilot</h2>
        {state.kind === 'done' && (
          <Button variant="ghost" onClick={generate}>
            Re-run
          </Button>
        )}
      </div>
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        Decision-support only — not a diagnosis. You decide what enters the record.
      </p>

      {state.kind === 'loading' || state.kind === 'generating' ? (
        <p className="text-sm text-[var(--color-ink-3)]">
          {state.kind === 'generating' ? 'Thinking through the differential…' : 'Loading…'}
        </p>
      ) : state.kind === 'failed' ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-warn)]">{state.message}</p>
          <Button variant="secondary" onClick={generate}>
            Try again
          </Button>
        </div>
      ) : (
        <DifferentialBody d={state.differential} />
      )}
    </Card>
  );
}

function DifferentialBody({ d }: { d: DifferentialDiagnosisV1 }) {
  return (
    <div className="space-y-5">
      {d.codingNudges.length > 0 && (
        <ul className="space-y-1.5">
          {d.codingNudges.map((n, i) => (
            <li
              key={i}
              className={`rounded-lg border px-3 py-2 text-sm ${
                n.severity === 'warn'
                  ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)]'
              }`}
            >
              🧾 {codingPrefix(n)}
              {n.message}
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-3">
        {d.candidates.map((c, i) => (
          <CandidateRow key={i} c={c} rank={i + 1} />
        ))}
      </ol>

      {d.redFlagsToExclude.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Red flags to exclude
          </h3>
          <ul className="space-y-1.5">
            {d.redFlagsToExclude.map((r, i) => (
              <li
                key={i}
                className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-warn)]"
              >
                🔴 {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.disclaimer && <p className="text-xs italic text-[var(--color-ink-3)]">{d.disclaimer}</p>}
    </div>
  );
}

function CandidateRow({ c, rank }: { c: DifferentialCandidate; rank: number }) {
  return (
    <li className="rounded-xl border border-[var(--color-line)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--color-ink-3)]">#{rank}</span>
          <p className="font-medium text-[var(--color-ink)]">{c.condition}</p>
          {c.icd10Code && <Badge tone="muted">{c.icd10Code}</Badge>}
        </div>
        {c.likelihood !== undefined && (
          <span className="text-sm text-[var(--color-ink-2)]">
            {Math.round(c.likelihood * 100)}%
          </span>
        )}
      </div>
      {c.discriminatingQuestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Ask to discriminate
          </p>
          <ul className="ml-4 list-disc text-sm text-[var(--color-ink-2)]">
            {c.discriminatingQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {c.suggestedWorkup.length > 0 && (
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Workup:{' '}
          </span>
          {c.suggestedWorkup.join(' · ')}
        </p>
      )}
    </li>
  );
}

function codingPrefix(n: CodingNudge): string {
  const code = n.icd10Code ? `${n.icd10Code} — ` : '';
  if (n.kind === 'UNDERCODING') return `Undercoding: ${code}`;
  if (n.kind === 'DOCUMENTATION_GAP') return `Documentation: ${code}`;
  return code;
}
