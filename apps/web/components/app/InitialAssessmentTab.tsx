'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClinicalCrisisFlag,
  ClinicalCrisisSeverity,
  ClinicalDiagnosisCandidate,
  ClinicalReport,
  ClinicalRecommendedTherapy,
  InitialAssessmentBriefV1,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  sessionId: string;
  /// Sprint 20 — used to deep-link the recommended-instrument chips to
  /// the client's Instruments section so a baseline is one tap away.
  clientId: string;
  /// Wrapper carrying status + cost + errorMessage. Bodies are
  /// shape-different from a treatment-session ClinicalReport so the
  /// parsed brief is passed separately.
  reportEnvelope: Pick<ClinicalReport, 'status' | 'errorMessage'> | null;
  initialBrief: InitialAssessmentBriefV1 | null;
}

/**
 * Sprint 19 — INTAKE-kind sibling of ClinicalBriefTab.
 *
 * Renders InitialAssessmentBriefV1 — wider differential, more
 * assessment gaps, no treatment plan, an explicit list of
 * recommended scored instruments. Read-only: the
 * accept/modify/reject flow used for treatment-session brief sections
 * is not applicable until a treatment plan exists, which intakes
 * don't produce.
 */
export function InitialAssessmentTab({ sessionId, clientId, reportEnvelope, initialBrief }: Props) {
  const [brief, setBrief] = useState<InitialAssessmentBriefV1 | null>(initialBrief);
  const [status, setStatus] = useState<ClinicalReport['status'] | null>(
    reportEnvelope?.status ?? null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    reportEnvelope?.errorMessage ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  interface AnalysisResponse {
    report?: { status: ClinicalReport['status']; errorMessage: string | null };
    initialAssessmentBrief?: InitialAssessmentBriefV1 | null;
    error?: string;
  }

  const applyResponse = useCallback((payload: AnalysisResponse) => {
    if (payload.report) {
      setStatus(payload.report.status);
      setErrorMessage(payload.report.errorMessage);
    }
    if (payload.initialAssessmentBrief !== undefined) {
      setBrief(payload.initialAssessmentBrief ?? null);
    }
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as AnalysisResponse & {
        code?: string;
      };
      if (!res.ok) {
        // Sprint 56 hotfix — Pass 3 can't run if Pass 1 returned an empty
        // transcript. /clinical-analysis returns 409 NOTE_NOT_USABLE; the
        // therapist needs to re-run /generate-note (which retries Pass 1)
        // before retrying Pass 3 makes sense. Kick that flow so a single
        // Retry click here actually moves the user forward instead of
        // looping on the same 409.
        if (res.status === 409 && body.code === 'NOTE_NOT_USABLE') {
          const regen = await fetch(`/api/v1/sessions/${sessionId}/generate-note`, {
            method: 'POST',
          });
          if (!regen.ok) {
            const rb = (await regen.json().catch(() => ({}))) as { error?: string };
            throw new Error(
              rb.error ??
                'Could not re-run note generation. Open the Note tab and hit Retry there.',
            );
          }
          // Pass 1 just kicked off; clinical-analysis will get re-scheduled
          // by the generate-note route's after() callback once Pass 2
          // produces a valid draft. Bounce to PENDING so the poll picks
          // it up automatically.
          setStatus('PENDING');
          setError(null);
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      applyResponse(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [sessionId, applyResponse]);

  // Sprint 19 — poll while Pass 3 is running in the background. The
  // generate-note route schedules Pass 3 via Next's after() callback
  // so the user lands here in PENDING; we poll until the row flips
  // to COMPLETED or FAILED.
  useEffect(() => {
    if (status !== 'PENDING') return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
          cache: 'no-store',
        });
        if (res.status === 404) return;
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as AnalysisResponse;
        if (cancelled) return;
        applyResponse(body);
      } catch {
        // Swallow — next tick will retry.
      }
    };
    const id = setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, sessionId, applyResponse]);

  if (status === null || (status === 'COMPLETED' && !brief)) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">No initial assessment yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          The intake brief is generated automatically after the intake note finishes. If you don’t
          see one, the note may not have completed — generate the note first, then come back here.
        </p>
        <div className="mt-6">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Generating…' : 'Generate initial assessment'}
          </Button>
        </div>
        {error && <p className="mt-4 text-sm text-[var(--color-warn)]">{error}</p>}
      </Card>
    );
  }

  if (status === 'PENDING') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">Initial assessment is being prepared…</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Generating the initial assessment in the background. This usually takes 30-60 seconds
          after the intake note completes. If it’s been longer, the background run may have been
          killed by the serverless cap — re-run it now.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Re-running…' : 'Re-run now'}
          </Button>
        </div>
        {error && <p className="mt-4 text-sm text-[var(--color-warn)]">{error}</p>}
      </Card>
    );
  }

  if (status === 'FAILED' || !brief) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">Initial assessment generation failed</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-warn)]">
          {errorMessage ?? "Couldn't generate the initial assessment — try Regenerate."}
        </p>
        <div className="mt-6">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <CompletedBrief
      brief={brief}
      clientId={clientId}
      onRegenerate={generate}
      regenerating={generating}
    />
  );
}

// ============================================================================
// Completed brief — read-only sections.
// ============================================================================

function CompletedBrief({
  brief,
  clientId,
  onRegenerate,
  regenerating,
}: {
  brief: InitialAssessmentBriefV1;
  clientId: string;
  onRegenerate: () => void | Promise<void>;
  regenerating: boolean;
}) {
  const highestCrisis = useMemo(
    () => highestCrisisSeverity(brief.crisisFlags),
    [brief.crisisFlags],
  );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Initial assessment</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-2)]">
            AI decision-support for an intake. Wider differential than a treatment-session brief —
            the goal is to narrow it over the next few sessions, not to commit to a plan yet.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void onRegenerate()} disabled={regenerating}>
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </header>

      {brief.crisisFlags.length > 0 && (
        <CrisisBanner flags={brief.crisisFlags} highest={highestCrisis} />
      )}

      <Card className="p-6">
        <SectionHeader title="Working hypothesis" />
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
          {brief.workingHypothesis}
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Possible diagnoses — still narrowing"
          subtitle={`${brief.differential.length} candidate${brief.differential.length === 1 ? '' : 's'} · differential`}
        />
        <ul className="mt-3 space-y-3">
          {brief.differential.map((c, i) => (
            <DifferentialCard key={i} candidate={c} />
          ))}
        </ul>
        <p className="mt-3 text-xs italic text-[var(--color-ink-3)]">
          AI confidence stays low at intake by design — none of these are confirmed. Treat them as a
          starting point for the next 1-2 sessions.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Questions to answer next"
          subtitle="what's still missing before a working diagnosis"
        />
        {brief.assessmentGaps.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            No outstanding questions — the AI thinks the picture is clear enough.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {brief.assessmentGaps.map((g, i) => (
              <li
                key={i}
                className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4"
              >
                <p className="text-sm font-medium">{g.question}</p>
                <p className="mt-1 text-xs text-[var(--color-ink-3)]">{g.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Case formulation"
          subtitle={brief.language !== 'en' ? `language: ${brief.language}` : undefined}
        />
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
          {brief.formulation}
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Recommended therapies" />
        {brief.recommendedTherapies.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            No first-line therapies recommended — the differential is too uncertain.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {brief.recommendedTherapies.map((t, i) => (
              <TherapyCard key={i} therapy={t} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <SectionHeader title="Recommended scored instruments" />
        {brief.recommendedInstruments.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            No specific instruments recommended.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {brief.recommendedInstruments.map((key) => {
              const administerable = isAdministerable(key);
              return administerable ? (
                <li key={key}>
                  <a
                    href={`/app/clients/${clientId}#instruments`}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
                  >
                    + Administer {key}
                  </a>
                </li>
              ) : (
                <li
                  key={key}
                  className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-sm text-[var(--color-ink-2)]"
                >
                  {key}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs italic text-[var(--color-ink-3)]">
          Administer the screeners now to lock in a baseline — every later session measures change
          against it.
        </p>
      </Card>
    </div>
  );
}

function DifferentialCard({ candidate }: { candidate: ClinicalDiagnosisCandidate }) {
  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <strong className="font-mono text-sm">{candidate.icd11Code}</strong>{' '}
          <span className="text-sm">{candidate.icd11Label}</span>
        </div>
        <Badge tone="muted">AI confidence {(candidate.confidence * 100).toFixed(0)}%</Badge>
      </div>
      <ul className="mt-3 space-y-1">
        {candidate.supportingEvidence.map((q, j) => (
          <li key={j} className="text-xs italic text-[var(--color-ink-3)]">
            “{q.quote}” — {q.speaker} @ {formatTimestamp(q.startMs)}
          </li>
        ))}
      </ul>
      {candidate.gapsToFill.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Questions to answer next
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-ink-2)]">
            {candidate.gapsToFill.map((g, j) => (
              <li key={j}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function TherapyCard({ therapy }: { therapy: ClinicalRecommendedTherapy }) {
  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm">{therapy.name}</strong>
        <Badge tone="muted">when: {therapy.whenInPlan}</Badge>
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">{therapy.rationale}</p>
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">{therapy.evidenceSummary}</p>
    </li>
  );
}

function CrisisBanner({
  flags,
  highest,
}: {
  flags: ClinicalCrisisFlag[];
  highest: ClinicalCrisisSeverity | 'none';
}) {
  const critical = highest === 'critical' || highest === 'high';
  return (
    <div
      className={
        critical
          ? 'rounded-2xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-6'
          : 'rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6'
      }
      role="alert"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-xl">
          {critical ? 'Crisis flags detected' : 'Crisis review'}
        </h3>
        <Badge tone={critical ? 'warn' : 'muted'}>severity: {highest}</Badge>
      </div>
      <ul className="mt-3 space-y-3">
        {flags.map((f, i) => (
          <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-sm">{labelForCrisisKind(f.kind)}</strong>
              <Badge tone="warn">{f.severity}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">{f.recommendedAction}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-xl bg-white/60 p-4 text-sm">
        <p className="font-medium">India crisis support — share with the client today:</p>
        <ul className="mt-2 space-y-1 text-[var(--color-ink-2)]">
          <li>iCall (TISS) — 9152987821 (Mon-Sat, 8am-10pm)</li>
          <li>Vandrevala Foundation — 1860-2662-345 (24×7)</li>
          <li>NIMHANS Helpline — 080-46110007 (24×7)</li>
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 className="font-serif text-xl">{title}</h3>
        {subtitle && (
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{subtitle}</p>
        )}
      </div>
      <p className="text-xs italic text-[var(--color-ink-3)]">
        AI suggestion — verify before acting.
      </p>
    </header>
  );
}

function highestCrisisSeverity(flags: ClinicalCrisisFlag[]): ClinicalCrisisSeverity | 'none' {
  const rank: Record<ClinicalCrisisSeverity | 'none', number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  let max: ClinicalCrisisSeverity | 'none' = 'none';
  for (const f of flags) {
    if (rank[f.severity] > rank[max]) max = f.severity;
  }
  return max;
}

function labelForCrisisKind(kind: ClinicalCrisisFlag['kind']): string {
  switch (kind) {
    case 'suicidal_ideation':
      return 'Suicidal ideation';
    case 'suicidal_plan':
      return 'Suicidal plan / means';
    case 'harm_to_others':
      return 'Risk of harm to others';
    case 'child_safety':
      return 'Child safety concern';
    case 'intimate_partner_violence':
      return 'Intimate partner violence';
    case 'psychosis':
      return 'Possible psychosis';
    case 'substance_emergency':
      return 'Substance emergency';
  }
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Whether a recommended-instrument label maps to one the runner can
 * actually administer (PHQ-9 / GAD-7 today). Tolerant of hyphen/spacing
 * variants the model might emit ("PHQ-9", "phq9").
 */
function isAdministerable(key: string): boolean {
  const normalised = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalised === 'PHQ9' || normalised === 'GAD7';
}
