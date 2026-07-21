'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AssessmentGapPurpose,
  CarriedQuestion,
  ClinicalAssessmentGap,
  ClinicalCrisisFlag,
  ClinicalCrisisSeverity,
  ClinicalDiagnosisCandidate,
  ClinicalPlanSuggestion,
  ClinicalRecommendedTherapy,
  ClinicalReport,
  ClinicalSectionConfirmation,
  ClinicalTreatmentPlan,
  InitialAssessmentBriefV1,
  SessionKind,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PlanEditor } from './ClinicalBriefTab';

// ============================================================================
// Sprint TSC — the copilot decision board.
//
// Replaces the "wall of look-alike cards" (ClinicalBriefTab /
// InitialAssessmentTab) on the AI Copilot "This session" sub-tab with a
// two-lane decision board, doctor-style:
//
//   - LEFT — "AI suggests", five steps in working order: safety →
//     working impression → ask next session → suggested plan → baseline.
//     Every suggestion is an action; sand-topped cards + an AI tag mark
//     everything unconfirmed.
//   - RIGHT — "Your case record", green-topped and sticky: what the
//     therapist has actually accepted (diagnoses, plan version, safety
//     record, baselines, carried questions). Server truth, refreshed via
//     router.refresh() after every accept.
//
// One trust banner replaces the per-card disclaimers; the lane design
// enforces the same rule visually — nothing crosses lanes until accepted.
//
// The same shell serves both session kinds: INTAKE reads the
// InitialAssessmentBriefV1 (accepts via the intake-diagnosis route),
// TREATMENT/REVIEW read the ClinicalReportV1 (accepts via the existing
// sections route).
// ============================================================================

export interface RecordDiagnosis {
  icd11Code: string;
  icd11Label: string;
  isPrimary: boolean;
  confirmedAt: string;
  sessionId: string;
}

export interface RecordPlan {
  version: number;
  modality: string;
  goalCount: number;
  confirmedAt: string;
}

export interface RecordInstrument {
  instrumentKey: string;
  score: number;
  severity: string;
  administeredAt: string;
}

export interface CaseRecordSnapshot {
  diagnoses: RecordDiagnosis[];
  plan: RecordPlan | null;
  instruments: RecordInstrument[];
  safetyPlanConfirmedAt: string | null;
  carriedQuestions: CarriedQuestion[];
}

interface Props {
  sessionId: string;
  clientId: string;
  sessionKind: SessionKind;
  /// Full report DTO for BOTH kinds (body parses only for treatment;
  /// intake needs it for id + status + errorMessage).
  initialReport: ClinicalReport | null;
  /// Parsed intake brief (INTAKE kind only).
  initialBrief: InitialAssessmentBriefV1 | null;
  /// ISO timestamp of the last "Finish review" tap, or null. Passed
  /// separately from the report DTO (which doesn't carry it).
  reviewedAt: string | null;
  record: CaseRecordSnapshot;
}

/** The kind-normalised AI reading the five steps render from. */
interface BoardData {
  crisisFlags: ClinicalCrisisFlag[];
  impression: string;
  fullFormulation: string | null;
  candidates: ClinicalDiagnosisCandidate[];
  primaryIndex: number | null;
  gaps: ClinicalAssessmentGap[];
  therapies: ClinicalRecommendedTherapy[];
  plan: ClinicalTreatmentPlan | null;
  planSuggestions: ClinicalPlanSuggestion[];
  recommendedInstruments: string[];
}

interface AnalysisResponse {
  report?: ClinicalReport | null;
  initialAssessmentBrief?: InitialAssessmentBriefV1 | null;
  error?: string;
  code?: string;
}

export function CopilotDecisionBoard({
  sessionId,
  clientId,
  sessionKind,
  initialReport,
  initialBrief,
  reviewedAt,
  record,
}: Props) {
  const router = useRouter();
  const isIntake = sessionKind === 'INTAKE';
  const [report, setReport] = useState<ClinicalReport | null>(initialReport);
  const [brief, setBrief] = useState<InitialAssessmentBriefV1 | null>(initialBrief);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Set after a NOTE_NOT_USABLE kick re-ran generate-note: the report row may
  // not even exist yet, but Pass 3 is on its way — poll until it lands.
  const [kickedPending, setKickedPending] = useState(false);

  const applyResponse = useCallback((payload: AnalysisResponse) => {
    if (payload.report !== undefined) setReport(payload.report ?? null);
    if (payload.initialAssessmentBrief !== undefined) {
      setBrief(payload.initialAssessmentBrief ?? null);
    }
    if (payload.report && payload.report.status !== 'PENDING') setKickedPending(false);
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as AnalysisResponse;
      if (!res.ok) {
        // Pass 3 can't run when Pass 1 produced an unusable transcript —
        // kick generate-note (which retries Pass 1) so one Retry click
        // moves the therapist forward instead of looping on the same 409.
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
          setKickedPending(true);
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      applyResponse(body);
      router.refresh();
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [sessionId, applyResponse, router]);

  const status: ClinicalReport['status'] | null = kickedPending
    ? 'PENDING'
    : (report?.status ?? null);

  // Poll while Pass 3 runs in the background (generate-note schedules it via
  // after(), so the therapist can land here in PENDING).
  useEffect(() => {
    if (status !== 'PENDING') return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as AnalysisResponse;
        if (cancelled) return;
        applyResponse(body);
      } catch {
        // Swallow — next tick retries.
      }
    };
    const id = setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, sessionId, applyResponse]);

  const data: BoardData | null = useMemo(() => {
    if (isIntake) {
      if (!brief) return null;
      return {
        crisisFlags: brief.crisisFlags,
        impression: brief.workingHypothesis,
        fullFormulation: brief.formulation,
        candidates: brief.differential,
        primaryIndex: null,
        gaps: brief.assessmentGaps,
        therapies: brief.recommendedTherapies,
        plan: null,
        planSuggestions: [],
        recommendedInstruments: brief.recommendedInstruments,
      };
    }
    const body = report?.body;
    if (!body) return null;
    return {
      crisisFlags: body.crisisFlags,
      impression: body.formulation,
      fullFormulation: null,
      candidates: body.diagnosisCandidates,
      primaryIndex: body.primaryDiagnosisIndex,
      gaps: body.assessmentGaps,
      therapies: body.recommendedTherapies,
      plan: body.treatmentPlan,
      planSuggestions: body.planSuggestions ?? [],
      recommendedInstruments: [],
    };
  }, [isIntake, brief, report?.body]);

  // ----- accept plumbing -----

  const patchSection = useCallback(
    async (section: string, body: Record<string, unknown>): Promise<void> => {
      if (!report) throw new Error('No report to confirm against.');
      const res = await fetch(`/api/v1/clinical-reports/${report.id}/sections/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        report?: ClinicalReport;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      if (payload.report) setReport(payload.report);
      router.refresh();
    },
    [report, router],
  );

  const acceptIntakeDiagnosis = useCallback(
    async (
      candidateIndexes: number[],
      primarySelectionIndex: number | null,
      keepCodes: string[],
    ): Promise<void> => {
      if (!report) throw new Error('No report to confirm against.');
      const res = await fetch(`/api/v1/clinical-reports/${report.id}/intake-diagnosis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateIndexes,
          primarySelectionIndex,
          keepDiagnosisCodes: keepCodes,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      router.refresh();
    },
    [report, router],
  );

  const acceptIntakePlan = useCallback(
    async (plan: ClinicalTreatmentPlan): Promise<void> => {
      if (!report) throw new Error('No report to confirm against.');
      const res = await fetch(`/api/v1/clinical-reports/${report.id}/intake-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treatmentPlan: plan }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      router.refresh();
    },
    [report, router],
  );

  const acceptPlanSuggestion = useCallback(
    async (suggestionIndex: number): Promise<void> => {
      if (!report) throw new Error('No report to apply against.');
      const res = await fetch(`/api/v1/clinical-reports/${report.id}/plan-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionIndex }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      router.refresh();
    },
    [report, router],
  );

  const acceptIntakeCrisis = useCallback(async (): Promise<void> => {
    if (!report) throw new Error('No report to acknowledge against.');
    const res = await fetch(`/api/v1/clinical-reports/${report.id}/intake-crisis`, {
      method: 'POST',
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
    router.refresh();
  }, [report, router]);

  const finishReview = useCallback(async (): Promise<void> => {
    if (!report) throw new Error('No report to finish.');
    const res = await fetch(`/api/v1/clinical-reports/${report.id}/finish-review`, {
      method: 'POST',
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
    router.refresh();
  }, [report, router]);

  // ----- pre-reading states -----

  const measuresHref = `/app/sessions/${sessionId}?tab=copilot&sub=progress`;
  const readingNoun = isIntake ? 'initial assessment' : 'clinical brief';

  if (status === null || (status === 'COMPLETED' && !data)) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">No AI reading yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          The {readingNoun} is generated automatically after the note finishes. If you don't see
          one, the note may not have completed — generate the note first, then come back here.
        </p>
        <div className="mt-6">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Generating…' : `Generate ${readingNoun}`}
          </Button>
        </div>
        {genError && <p className="mt-4 text-sm text-[var(--color-warn)]">{genError}</p>}
      </Card>
    );
  }

  if (status === 'PENDING' || !data) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">
          {status === 'PENDING'
            ? "This session's reading is being prepared…"
            : `${capitalise(readingNoun)} generation failed`}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          {status === 'PENDING'
            ? 'Usually about a minute after the note is ready. If it takes longer, it may have stopped early — just re-run it.'
            : (report?.errorMessage ?? `Couldn't generate the ${readingNoun} — try again.`)}
        </p>
        <div className="mt-6">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Re-running…' : status === 'PENDING' ? 'Re-run now' : 'Retry'}
          </Button>
        </div>
        {genError && <p className="mt-4 text-sm text-[var(--color-warn)]">{genError}</p>}
      </Card>
    );
  }

  // ----- the board -----

  const confirmations = report?.confirmations ?? null;
  const highest = highestCrisisSeverity(data.crisisFlags);
  // Both kinds gate on an unacknowledged high/critical flag. Intake used to
  // skip the gate entirely (the highest-risk first contact had the weakest
  // safety step); it now lifts only when the crisis section is acknowledged
  // OR a safety plan is already on file. (R0 · finding D·18)
  const crisisConfirmed = confirmations != null && confirmations.crisis.status !== 'PENDING';
  const crisisAcknowledged = crisisConfirmed || (isIntake && record.safetyPlanConfirmedAt !== null);
  const crisisBlocking =
    !crisisAcknowledged &&
    data.crisisFlags.length > 0 &&
    (highest === 'high' || highest === 'critical');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-2xl">Review this session</h2>
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs text-[var(--color-ink-2)]">
          <AiChip inline />
          Suggestions only — nothing joins the record until you accept it.
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!isIntake && (
            <a
              href={`/api/v1/sessions/${sessionId}/clinical-report/pdf`}
              className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-white px-4 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]"
            >
              Download PDF
            </a>
          )}
          <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
            {generating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </header>
      {genError && <p className="text-sm text-[var(--color-warn)]">{genError}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* ================= AI lane ================= */}
        <div className="space-y-4">
          <LaneLabel>AI suggests — in the order you'd work</LaneLabel>

          <SafetyStep
            flags={data.crisisFlags}
            isIntake={isIntake}
            confirmation={confirmations?.crisis ?? null}
            safetyPlanConfirmedAt={record.safetyPlanConfirmedAt}
            onAcknowledge={
              isIntake ? acceptIntakeCrisis : () => patchSection('crisis', { action: 'accept' })
            }
          />

          <div className={crisisBlocking ? 'space-y-4 opacity-40' : 'space-y-4'}>
            <div
              className={crisisBlocking ? 'pointer-events-none select-none space-y-4' : 'space-y-4'}
            >
              <ImpressionStep
                sessionId={sessionId}
                isIntake={isIntake}
                impression={data.impression}
                fullFormulation={data.fullFormulation}
                candidates={data.candidates}
                confirmation={confirmations?.diagnosis ?? null}
                recordDiagnoses={record.diagnoses}
                onAcceptTreatment={(selected, primaryInSelected, reason, keepCodes) =>
                  patchSection('diagnosis', {
                    action: 'modify',
                    reason,
                    edits: {
                      diagnosisCandidates: selected,
                      primaryDiagnosisIndex: primaryInSelected,
                      keepDiagnosisCodes: keepCodes,
                    },
                  })
                }
                onAcceptIntake={acceptIntakeDiagnosis}
              />

              <AskNextStep
                sessionId={sessionId}
                clientId={clientId}
                gaps={data.gaps}
                carried={record.carriedQuestions}
                resolvedLabel={
                  record.diagnoses.find((d) => d.isPrimary)?.icd11Label ??
                  (data.primaryIndex !== null
                    ? (data.candidates[data.primaryIndex]?.icd11Label ?? null)
                    : null)
                }
                onSaved={() => router.refresh()}
              />

              <PlanStep
                isIntake={isIntake}
                plan={data.plan}
                planSuggestions={data.planSuggestions}
                therapies={data.therapies}
                confirmation={confirmations?.plan ?? null}
                recordPlan={record.plan}
                planHref={`/app/sessions/${sessionId}?tab=copilot&sub=plan`}
                onAccept={() => patchSection('plan', { action: 'accept' })}
                onModify={(edits, reason) =>
                  patchSection('plan', { action: 'modify', reason, edits })
                }
                onAcceptSuggestion={acceptPlanSuggestion}
                onDraftPlan={acceptIntakePlan}
              />

              <BaselineStep
                recommendedInstruments={data.recommendedInstruments}
                instruments={record.instruments}
                measuresHref={measuresHref}
              />

              <WrapUpStep
                isIntake={isIntake}
                hasCrisis={data.crisisFlags.length > 0}
                crisisAcknowledged={crisisAcknowledged}
                record={record}
                reviewedAt={reviewedAt}
                measuresHref={measuresHref}
                onFinish={finishReview}
              />
            </div>
            {crisisBlocking && (
              <p className="text-center text-xs font-medium text-[var(--color-warn)]">
                Acknowledge the safety review above to continue with the rest of the reading.
              </p>
            )}
          </div>
        </div>

        {/* ================= Your record lane ================= */}
        {/* Dimmed under an unacknowledged high/critical flag so the therapist
            can't skip ahead to the record's other decisions. (R0 · D·18) */}
        <div
          className={
            crisisBlocking
              ? 'pointer-events-none select-none space-y-2 opacity-40 lg:sticky lg:top-4'
              : 'space-y-2 lg:sticky lg:top-4'
          }
        >
          <LaneLabel>Your case record — what you've decided</LaneLabel>
          <RecordLane record={record} crisisFlags={data.crisisFlags} measuresHref={measuresHref} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step shell + shared chrome.
// ============================================================================

function LaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
      {children}
    </p>
  );
}

function AiChip({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${inline ? '' : 'absolute right-3.5 top-3 '}rounded-full border border-[#e7d9b0] bg-[#f6efdc] px-2 py-px text-[10px] font-bold tracking-[0.08em] text-[#8a7434]`}
    >
      AI
    </span>
  );
}

function Step({
  no,
  title,
  titleExtra,
  sub,
  tone = 'ai',
  children,
}: {
  no: number;
  title: string;
  titleExtra?: React.ReactNode;
  sub: string;
  tone?: 'ai' | 'risk';
  children: React.ReactNode;
}) {
  return (
    <Card
      className={`relative border-t-[3px] ${
        tone === 'risk' ? 'border-t-[var(--color-warn-border)]' : 'border-t-[#d9c9a3]'
      }`}
    >
      <AiChip />
      <div className="flex gap-3 p-5">
        <span
          className={`mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full text-[13px] font-bold ${
            tone === 'risk'
              ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
              : 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          }`}
        >
          {no}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15.5px] font-semibold">
            {title}
            {titleExtra}
          </p>
          <p className="mb-3 mt-0.5 text-xs text-[var(--color-ink-3)]">{sub}</p>
          {children}
        </div>
      </div>
    </Card>
  );
}

function DoneChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e6de] bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
      ✓ {children}
    </span>
  );
}

/** Small pill-shaped action button (the mock's `.act`). */
function Act({
  children,
  onClick,
  primary = false,
  quiet = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  quiet?: boolean;
  disabled?: boolean;
}) {
  const cls = primary
    ? 'border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
    : quiet
      ? 'border border-transparent text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
      : 'border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-accent)] hover:border-[var(--color-accent)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:border-transparent disabled:bg-[var(--color-line-soft)] disabled:text-[var(--color-ink-3)] ${cls}`}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Step 1 — Safety.
// ============================================================================

const CRISIS_HOTLINES: { name: string; number: string }[] = [
  { name: 'iCall', number: '9152987821' },
  { name: 'Vandrevala', number: '1860-2662-345' },
  { name: 'NIMHANS', number: '080-46110007' },
];

function SafetyStep({
  flags,
  isIntake,
  confirmation,
  safetyPlanConfirmedAt,
  onAcknowledge,
}: {
  flags: ClinicalCrisisFlag[];
  isIntake: boolean;
  confirmation: ClinicalSectionConfirmation | null;
  safetyPlanConfirmedAt: string | null;
  onAcknowledge: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highest = highestCrisisSeverity(flags);
  const acknowledged = confirmation !== null && confirmation.status !== 'PENDING';

  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAcknowledge();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (flags.length === 0) {
    return (
      <Step no={1} title="Safety first" sub="Checked on every reading." tone="ai">
        <p className="text-sm text-[var(--color-ink-2)]">
          No safety flags detected in this session.
          {safetyPlanConfirmedAt && (
            <span className="ml-2">
              <DoneChip>Safety plan on file</DoneChip>
            </span>
          )}
        </p>
      </Step>
    );
  }

  return (
    <Step
      no={1}
      title="Safety first"
      titleExtra={
        <span className="rounded-full bg-[var(--color-warn)] px-2.5 py-px text-[10.5px] font-bold tracking-[0.06em] text-white">
          {highest.toUpperCase()}
        </span>
      }
      sub="Deal with this before anything else on the page."
      tone="risk"
    >
      <div className="space-y-2" role="alert">
        {flags.map((f, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3.5 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b>{labelForCrisisKind(f.kind)}</b>
              <Badge tone="warn">{f.severity}</Badge>
            </div>
            {f.indicators.length > 0 && (
              <p className="mt-1 text-xs italic text-[var(--color-ink-2)]">
                “{f.indicators[0]!.quote}”{' '}
                <span className="not-italic text-[var(--color-ink-3)]">
                  — {f.indicators[0]!.speaker} @ {formatTimestamp(f.indicators[0]!.startMs)}
                </span>
              </p>
            )}
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-2)]">{f.recommendedAction}</p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CRISIS_HOTLINES.map((h) => (
          <a
            key={h.name}
            href={`tel:${h.number.replace(/[^+\d]/g, '')}`}
            className="rounded-full border border-[var(--color-warn-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-xs text-[var(--color-ink-2)] tabular-nums hover:border-[var(--color-warn)]"
          >
            {h.name} — {h.number}
          </a>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isIntake ? (
          acknowledged ? (
            <DoneChip>Safety reviewed {formatDate(confirmation.confirmedAt)}</DoneChip>
          ) : safetyPlanConfirmedAt ? (
            <DoneChip>Safety plan on file · {formatDate(safetyPlanConfirmedAt)}</DoneChip>
          ) : (
            <>
              <Act primary onClick={() => void acknowledge()} disabled={busy}>
                {busy ? 'Saving…' : 'Acknowledge safety review'}
              </Act>
              <span className="text-xs text-[var(--color-ink-3)]">
                Build a safety plan with the client before they leave.
              </span>
            </>
          )
        ) : acknowledged ? (
          <DoneChip>Reviewed {formatDate(confirmation.confirmedAt)}</DoneChip>
        ) : (
          <Act primary onClick={() => void acknowledge()} disabled={busy}>
            {busy ? 'Saving…' : 'Acknowledge safety review'}
          </Act>
        )}
        {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
      </div>
    </Step>
  );
}

// ============================================================================
// Step 2 — Working impression (the differential you can act on).
// ============================================================================

function ImpressionStep({
  sessionId,
  isIntake,
  impression,
  fullFormulation,
  candidates,
  confirmation,
  recordDiagnoses,
  onAcceptTreatment,
  onAcceptIntake,
}: {
  sessionId: string;
  isIntake: boolean;
  impression: string;
  fullFormulation: string | null;
  candidates: ClinicalDiagnosisCandidate[];
  confirmation: ClinicalSectionConfirmation | null;
  recordDiagnoses: RecordDiagnosis[];
  onAcceptTreatment: (
    selected: ClinicalDiagnosisCandidate[],
    primaryInSelected: number | null,
    reason: string,
    keepCodes: string[],
  ) => Promise<void>;
  onAcceptIntake: (
    candidateIndexes: number[],
    primarySelectionIndex: number | null,
    keepCodes: string[],
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Both kinds start empty — the therapist owns exactly what enters the
  // record; nothing is accepted by a habitual click. (R0 · finding C·19)
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [primary, setPrimary] = useState<number | null>(null);

  // Carryover: diagnoses already active on the record whose ICD-11 code is NOT
  // in today's candidate list — comorbid diagnoses from earlier sessions.
  // Accepting rebuilds the active set, so unless these are explicitly KEPT they
  // are silently retired. Show them as pre-ticked keep-rows. (R0 · C·19)
  const candidateCodes = useMemo(() => new Set(candidates.map((c) => c.icd11Code)), [candidates]);
  const carryover = useMemo(
    () => recordDiagnoses.filter((d) => !candidateCodes.has(d.icd11Code)),
    [recordDiagnoses, candidateCodes],
  );
  const [kept, setKept] = useState<Set<string>>(() => new Set(carryover.map((d) => d.icd11Code)));
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Change decision" reopens the accepted view for a fresh accept.
  const [reopened, setReopened] = useState(false);

  const confirmed = confirmation !== null && confirmation.status !== 'PENDING';
  const intakeAccepted = isIntake && recordDiagnoses.some((d) => d.sessionId === sessionId);
  const decided = confirmed || intakeAccepted;
  // When reopened, the step is editable again even though a decision exists.
  const done = decided && !reopened;

  // Reopen the selection pre-loaded from the CURRENT record, so re-accepting
  // starts from what's true today (not the AI's original slate). Re-accepting
  // supersedes the prior diagnosis rows; the record keeps full history.
  const reopen = () => {
    const activeCodes = new Map(recordDiagnoses.map((d) => [d.icd11Code, d]));
    const sel = new Set<number>();
    let prim: number | null = null;
    candidates.forEach((c, i) => {
      const rec = activeCodes.get(c.icd11Code);
      if (rec) {
        sel.add(i);
        if (rec.isPrimary) prim = i;
      }
    });
    // Start from what the record says today; nothing pre-selected otherwise.
    setSelected(sel);
    setPrimary(sel.size > 0 ? prim : null);
    setKept(new Set(carryover.map((d) => d.icd11Code)));
    setDismissed(new Set());
    setError(null);
    setReopened(true);
  };

  const toggleKeep = (code: string) =>
    setKept((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const toggleExpand = (i: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const toggleSelect = (i: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) {
        next.delete(i);
        setPrimary((p) => (p === i ? null : p));
      } else {
        next.add(i);
      }
      return next;
    });
  };

  const dismiss = (i: number) => {
    setDismissed((s) => new Set(s).add(i));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(i);
      return next;
    });
    setPrimary((p) => (p === i ? null : p));
    setExpanded((s) => {
      const next = new Set(s);
      next.delete(i);
      return next;
    });
  };

  const keptCodes = carryover.filter((d) => kept.has(d.icd11Code)).map((d) => d.icd11Code);
  const retiring = carryover.filter((d) => !kept.has(d.icd11Code));

  const accept = async () => {
    const selectedIdxs = candidates.map((_, i) => i).filter((i) => selected.has(i));
    if (selectedIdxs.length === 0) return;
    const primaryPos = primary !== null ? selectedIdxs.indexOf(primary) : -1;
    setBusy(true);
    setError(null);
    try {
      if (isIntake) {
        await onAcceptIntake(selectedIdxs, primaryPos >= 0 ? primaryPos : null, keptCodes);
      } else {
        const retiredNote =
          retiring.length > 0 ? `; retired ${retiring.length} prior active diagnosis(es)` : '';
        await onAcceptTreatment(
          selectedIdxs.map((i) => candidates[i]!),
          primaryPos >= 0 ? primaryPos : null,
          `Decision board: accepted ${selectedIdxs.length} of ${candidates.length} candidate(s) as the working diagnosis${retiredNote}.`,
          keptCodes,
        );
      }
      setReopened(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const visible = candidates.map((_, i) => i).filter((i) => !dismissed.has(i));

  return (
    <Step
      no={2}
      title="Working impression"
      sub={
        isIntake
          ? 'Confidence stays low at intake by design — accept only what you’re ready to own.'
          : 'The AI’s read of this session. Accept only what you’re ready to own.'
      }
    >
      <p className="mb-3 whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
        {impression}
      </p>
      {fullFormulation && fullFormulation !== impression && (
        <details className="mb-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-accent)]">
            Full case formulation
          </summary>
          <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-ink-2)]">
            {fullFormulation}
          </p>
        </details>
      )}

      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          The AI did not propose any diagnosis candidates — evidence too thin.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((i) => {
            const c = candidates[i]!;
            const isOpen = expanded.has(i);
            const isSelected = selected.has(i);
            // UI truth pass — a candidate that IS the active record diagnosis
            // used to render as a brand-new suggestion, silently asking the
            // therapist to re-accept what they already confirmed. Badge it.
            const onRecord = recordDiagnoses.find((d) => d.icd11Code === c.icd11Code);
            return (
              <div key={i}>
                <div
                  className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                    isSelected
                      ? 'border-[#d8e6de] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-line-soft)] bg-white/30'
                  }`}
                >
                  {!done && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(i)}
                      aria-label={`Select ${c.icd11Code} ${c.icd11Label}`}
                      className="accent-[var(--color-accent)]"
                    />
                  )}
                  <span className="flex-none rounded-md bg-[var(--color-surface-soft)] px-1.5 py-0.5 font-mono text-xs font-bold text-[var(--color-ink-2)]">
                    {c.icd11Code}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    className="min-w-0 flex-1 text-left text-sm font-semibold"
                  >
                    {c.icd11Label}
                    {onRecord && (
                      <span className="ml-2 align-middle">
                        <Badge tone="muted">
                          {onRecord.isPrimary ? 'on record · primary' : 'on record'}
                        </Badge>
                      </span>
                    )}
                    {primary === i && (
                      <span className="ml-2 align-middle">
                        <Badge tone="accent">primary</Badge>
                      </span>
                    )}
                  </button>
                  {/* Mobile: the confidence meter drops to its own full-width
                      row instead of squeezing the label to one word a line. */}
                  <span className="w-24 flex-none max-sm:order-last max-sm:w-full">
                    <span className="block h-[5px] overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                      <span
                        className="block h-full bg-[var(--color-accent)] opacity-75"
                        style={{ width: `${Math.round(c.confidence * 100)}%` }}
                      />
                    </span>
                    <span className="mt-0.5 block text-right text-[11px] text-[var(--color-ink-3)] tabular-nums">
                      AI {Math.round(c.confidence * 100)}%
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    className="flex-none text-xs text-[var(--color-ink-3)]"
                  >
                    {isOpen ? '▴' : '▾'}
                  </button>
                </div>
                {isOpen && (
                  <div className="mt-1.5 rounded-xl bg-[var(--color-surface-soft)] p-3.5 text-[12.5px]">
                    {c.supportingEvidence.map((q, j) => (
                      <p key={j} className="mb-1 italic text-[var(--color-ink-2)]">
                        “{q.quote}”{' '}
                        <span className="not-italic text-[var(--color-ink-3)] tabular-nums">
                          — {q.speaker} @ {formatTimestamp(q.startMs)}
                        </span>
                      </p>
                    ))}
                    {c.gapsToFill.length > 0 && (
                      <>
                        <b className="text-[11px] tracking-[0.08em] text-[var(--color-ink-3)]">
                          TO CONFIRM, ESTABLISH
                        </b>
                        <ul className="mt-1 list-disc pl-4 text-[var(--color-ink-2)]">
                          {c.gapsToFill.map((g, j) => (
                            <li key={j}>{g}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {!done && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Act
                          onClick={() => {
                            if (!isSelected) toggleSelect(i);
                            setPrimary(i);
                          }}
                          disabled={primary === i}
                        >
                          {primary === i ? 'Marked primary' : 'Mark as primary'}
                        </Act>
                        <Act quiet onClick={() => dismiss(i)}>
                          Dismiss
                        </Act>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dismissed.size > 0 && !done && (
        <button
          type="button"
          onClick={() => setDismissed(new Set())}
          className="mt-2 text-xs font-medium text-[var(--color-ink-3)] underline"
        >
          {dismissed.size} set aside · restore
        </button>
      )}

      {/* Carryover — active diagnoses from earlier sessions not in today's
          candidates. Pre-ticked to KEEP; untick to retire on this accept.
          Without this, accepting silently wiped comorbid diagnoses. (R0 · C·19) */}
      {carryover.length > 0 && !done && (
        <div className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
            Already in the record — keep or retire
          </p>
          <div className="space-y-1.5">
            {carryover.map((d) => {
              const keep = kept.has(d.icd11Code);
              return (
                <label
                  key={d.icd11Code}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${
                    keep
                      ? 'border-[var(--color-line)] bg-white/60'
                      : 'border-dashed border-[var(--color-warn-border)] bg-[var(--color-warn-bg)]/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={() => toggleKeep(d.icd11Code)}
                    className="accent-[var(--color-accent)]"
                    aria-label={`Keep ${d.icd11Code} ${d.icd11Label}`}
                  />
                  <span className="flex-none rounded-md bg-[var(--color-surface-soft)] px-1.5 py-0.5 font-mono text-xs font-bold text-[var(--color-ink-2)]">
                    {d.icd11Code}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium">
                    {d.icd11Label}
                    {d.isPrimary && (
                      <span className="ml-2 align-middle">
                        <Badge tone="accent">primary</Badge>
                      </span>
                    )}
                  </span>
                  <span
                    className={`flex-none text-[11px] font-medium ${
                      keep ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-warn)]'
                    }`}
                  >
                    {keep ? 'keeping' : 'will retire'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {done ? (
          <>
            <DoneChip>
              {intakeAccepted
                ? `${recordDiagnoses.filter((d) => d.sessionId === sessionId).length} in your record`
                : `In your record — ${confirmation!.status.toLowerCase()} ${formatDate(confirmation!.confirmedAt)}`}
            </DoneChip>
            <Act onClick={reopen}>Change decision</Act>
          </>
        ) : (
          candidates.length > 0 && (
            <>
              <Act primary onClick={() => void accept()} disabled={busy || selected.size === 0}>
                {busy
                  ? 'Saving…'
                  : `Accept ${selected.size || ''}${selected.size ? ' ' : ''}as working diagnosis`}
              </Act>
              {reopened && (
                <Act quiet onClick={() => setReopened(false)} disabled={busy}>
                  Cancel
                </Act>
              )}
              <span className="text-[11px] text-[var(--color-ink-3)]">
                {retiring.length > 0
                  ? `Accepting adds your selection and retires ${retiring.length} unkept diagnosis(es); history is kept.`
                  : 'Accepting adds your selection to the record; kept diagnoses stay active.'}
              </span>
            </>
          )
        )}
        {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
      </div>
    </Step>
  );
}

// ============================================================================
// Step 3 — Ask next session (the assessment ENGINE, as a carry-able checklist).
//
// Questions arrive grouped by the job they do (safety / differentiate /
// confirm / context — the gap.purpose field). Differentiate + confirm
// questions show the ICD codes they bear on as chips, so the therapist can
// see WHY each question is on the list. Pre-V2 gaps (no purpose) fall into
// an "open questions" group; a safety-shaped question is inferred from
// wording as a fallback. Ticked questions carry into the pre-session brief;
// the carry-cap of 8 keeps that brief scannable and is the ONLY cap — the
// engine itself is uncapped, and shrinks to zero as assessment resolves.
// ============================================================================

const RISK_FIRST_RE = /suicid|self-harm|risk|safety|harm to/i;
const MAX_CARRIED = 8;

type GapGroupKey = AssessmentGapPurpose | 'other';

const GAP_GROUPS: { key: GapGroupKey; label: string; risk?: boolean }[] = [
  { key: 'safety', label: 'Safety — ask first', risk: true },
  { key: 'differentiate', label: 'To tell apart' },
  { key: 'confirm', label: 'To confirm' },
  { key: 'context', label: 'Context' },
  { key: 'other', label: 'Open questions' },
];

function gapGroupKey(g: ClinicalAssessmentGap): GapGroupKey {
  if (g.purpose) return g.purpose;
  // Back-compat for pre-V2 rows: infer safety from wording, else "other".
  return RISK_FIRST_RE.test(g.question) ? 'safety' : 'other';
}

function AskNextStep({
  sessionId,
  clientId,
  gaps,
  carried,
  resolvedLabel,
  onSaved,
}: {
  sessionId: string;
  clientId: string;
  gaps: ClinicalAssessmentGap[];
  carried: CarriedQuestion[];
  /// Primary confirmed/candidate label, shown in the "assessment complete"
  /// state so it reads "resolved to X".
  resolvedLabel: string | null;
  onSaved: () => void;
}) {
  const initialSelected = useMemo(
    () =>
      new Set(
        gaps.filter((g) => carried.some((c) => c.question === g.question)).map((g) => g.question),
      ),
    [gaps, carried],
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Carried questions this board doesn't manage (from other sessions, or
  // wording that no longer matches a current gap) are preserved on save.
  const untouched = useMemo(
    () => carried.filter((c) => !gaps.some((g) => g.question === c.question)),
    [carried, gaps],
  );
  const atCap = untouched.length + selected.size >= MAX_CARRIED;

  const dirty =
    selected.size !== initialSelected.size || [...selected].some((q) => !initialSelected.has(q));

  const toggle = (q: string) => {
    setSaved(false);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(q)) next.delete(q);
      else if (untouched.length + next.size < MAX_CARRIED) next.add(q);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const questions: CarriedQuestion[] = [
        ...untouched,
        ...gaps
          .filter((g) => selected.has(g.question))
          .map((g) => ({
            question: g.question.slice(0, 500),
            rationale: g.rationale ? g.rationale.slice(0, 1000) : null,
            sourceSessionId: sessionId,
            carriedAt: now,
          })),
      ].slice(0, MAX_CARRIED);
      const res = await fetch(`/api/v1/clients/${clientId}/carried-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Group gaps by the job they do, in engine order. Empty groups are skipped.
  const grouped = useMemo(
    () =>
      GAP_GROUPS.map((grp) => ({
        ...grp,
        items: gaps.filter((g) => gapGroupKey(g) === grp.key),
      })).filter((grp) => grp.items.length > 0),
    [gaps],
  );

  return (
    <Step
      no={3}
      title="Ask next session"
      sub={
        gaps.length === 0
          ? 'The AI found nothing material still open.'
          : `${gaps.length} still open · tick the ones to seed next session's AI opening brief. Regenerated each session — shrinks as your assessment completes.`
      }
    >
      {gaps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-white/30 p-4 text-[13px]">
          <b className="text-[var(--color-accent)]">✓ Assessment complete</b>
          <span className="text-[var(--color-ink-2)]">
            {' '}
            — the differential has resolved
            {resolvedLabel ? ` to ${resolvedLabel}` : ''}. Nothing material is open; carry a
            question only if you want to revisit it.
          </span>
        </div>
      ) : (
        <div className="space-y-3.5">
          {grouped.map((grp) => (
            <div key={grp.key}>
              <p
                className={`mb-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] ${
                  grp.risk ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-3)]'
                }`}
              >
                {grp.label}
                {grp.items.map((g, k) =>
                  g.targets.length > 0 ? (
                    <span
                      key={k}
                      className="rounded-full bg-[var(--color-accent-soft)] px-2 py-px text-[10px] font-semibold normal-case tracking-normal text-[var(--color-accent)]"
                    >
                      {g.targets.join(' ↔ ')}
                    </span>
                  ) : null,
                )}
              </p>
              <div className="space-y-1.5">
                {grp.items.map((g) => {
                  const checked = selected.has(g.question);
                  return (
                    <label
                      key={g.question}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--color-line-soft)] p-3"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(g.question)}
                        disabled={!checked && atCap}
                        className="mt-1 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0">
                        <b className="block text-[13.5px] font-semibold">
                          {g.question}
                          {grp.key === 'safety' && (
                            <span className="ml-2 rounded-full bg-[var(--color-warn-soft)] px-2 py-px align-middle text-[10px] font-bold tracking-[0.06em] text-[var(--color-warn)]">
                              FIRST
                            </span>
                          )}
                        </b>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">
                          {g.rationale}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {gaps.length > 0 && (
          <Act primary onClick={() => void save()} disabled={busy || !dirty}>
            {busy
              ? 'Saving…'
              : selected.size > 0
                ? `Carry ${selected.size} to next session`
                : 'Clear carried questions'}
          </Act>
        )}
        {saved && <DoneChip>Will open the next pre-session brief</DoneChip>}
        {atCap && (
          <span className="text-[11px] text-[var(--color-ink-3)]">
            Carry limit reached ({MAX_CARRIED}).
          </span>
        )}
        {untouched.length > 0 && (
          <span className="text-[11px] text-[var(--color-ink-3)]">
            +{untouched.length} carried earlier (kept).
          </span>
        )}
        {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
      </div>

      {/* Cross-link (R3b): the carried picks are what you seed here; the full,
          durable open-questions ledger — ranked, stale-flagged, closeable —
          lives on Progress. Naming them apart stops the two reading as one. */}
      <p className="mt-3 border-t border-[var(--color-line-soft)] pt-2.5 text-[11px] text-[var(--color-ink-3)]">
        Ticked questions seed the next pre-session brief. The full open-questions ledger lives on
        the{' '}
        <Link
          href={`/app/sessions/${sessionId}?tab=copilot&sub=progress`}
          className="font-medium text-[var(--color-accent)] hover:underline"
        >
          Progress tab
        </Link>
        .
      </p>
    </Step>
  );
}

// ============================================================================
// Step 4 — Suggested plan (treatment) / suggested approaches (intake).
// ============================================================================

function PlanStep({
  isIntake,
  plan,
  planSuggestions,
  therapies,
  confirmation,
  recordPlan,
  planHref,
  onAccept,
  onModify,
  onAcceptSuggestion,
  onDraftPlan,
}: {
  isIntake: boolean;
  plan: ClinicalTreatmentPlan | null;
  /// Plan-as-diff (R3): edits proposed to the client's ACTIVE plan on a
  /// follow-up. Empty on intakes / first plans / when the AI proposed none.
  planSuggestions: ClinicalPlanSuggestion[];
  therapies: ClinicalRecommendedTherapy[];
  confirmation: ClinicalSectionConfirmation | null;
  /// The client's active plan (right-lane truth). On intakes, its presence
  /// means "plan v1 already drafted".
  recordPlan: RecordPlan | null;
  /// Link to the Plan tab where the plan of record lives + is editable.
  planHref: string;
  onAccept: () => Promise<void>;
  onModify: (edits: unknown, reason: string) => Promise<void>;
  /// Apply one plan suggestion (by index) → a new plan version.
  onAcceptSuggestion: (suggestionIndex: number) => Promise<void>;
  /// Intake only — create/replace treatment-plan v1 from the drafted plan.
  onDraftPlan: (plan: ClinicalTreatmentPlan) => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | 'accept' | 'modify'>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirmation !== null && confirmation.status !== 'PENDING';

  const accept = async () => {
    setBusy('accept');
    setError(null);
    try {
      await onAccept();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const modify = async (edits: unknown, reason: string) => {
    setBusy('modify');
    setError(null);
    try {
      await onModify(edits, reason);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // --- Intake: tick approaches → draft a versioned plan v1. ---
  if (isIntake || !plan) {
    return (
      <IntakePlanStep therapies={therapies} recordPlan={recordPlan} onDraftPlan={onDraftPlan} />
    );
  }

  // The AI's suggested plan detail. Shown live before a decision; collapsed
  // behind a disclosure once the plan is in the record, so the step never
  // presents the AI suggestion AS the plan of record. (R0 · finding A·02)
  const aiPlanDetail = (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
            Modality
          </dt>
          <dd className="capitalize">{plan.modality}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
            Expected duration
          </dt>
          <dd>
            {plan.expectedDurationSessions !== null
              ? `${plan.expectedDurationSessions} sessions`
              : 'too uncertain'}
          </dd>
        </div>
      </dl>
      <ol className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
        {plan.phaseSequence.map((p, i) => (
          <li
            key={i}
            className="rounded-full bg-[var(--color-surface-soft)] px-2.5 py-1 text-[var(--color-ink-2)]"
          >
            {i + 1}. {p}
          </li>
        ))}
      </ol>
      <ul className="mt-2.5 space-y-1.5">
        {plan.goals.map((g, i) => (
          <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-3">
            <p className="text-sm font-medium">{g.description}</p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">measure: {g.measure}</p>
          </li>
        ))}
      </ul>
      {therapies.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-accent)]">
            Recommended approaches ({therapies.length})
          </summary>
          <div className="mt-2 space-y-2">
            {therapies.map((t, i) => (
              <TherapyCard key={i} therapy={t} />
            ))}
          </div>
        </details>
      )}
    </>
  );

  if (confirmed) {
    return (
      <Step
        no={4}
        title="Plan update"
        sub="This session's plan decision is in your record — the plan itself lives on the Plan tab."
      >
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-accent-soft)] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {recordPlan
                ? `Plan v${recordPlan.version} is in your record`
                : 'Plan is in your record'}
              {recordPlan && (
                <span className="ml-2 text-xs font-normal capitalize text-[var(--color-ink-3)]">
                  {recordPlan.modality} · {recordPlan.goalCount} goal
                  {recordPlan.goalCount === 1 ? '' : 's'} ·{' '}
                  <span className="lowercase">{confirmation!.status.toLowerCase()}</span>{' '}
                  {formatDate(confirmation!.confirmedAt)}
                </span>
              )}
            </p>
            <a href={planHref} className="text-xs font-semibold text-[var(--color-accent)]">
              View &amp; edit on the Plan tab →
            </a>
          </div>
          {confirmation!.status === 'MODIFIED' && (
            <p className="mt-1.5 text-xs text-[var(--color-ink-2)]">
              You edited this before accepting — your saved plan may differ from the AI's original
              suggestion below.
            </p>
          )}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-accent)]">
            What the AI suggested for this session
          </summary>
          <div className="mt-2">{aiPlanDetail}</div>
        </details>
      </Step>
    );
  }

  // Plan-as-diff (R3): a follow-up where the client ALREADY has a plan. The
  // therapist owns that plan, so the copilot proposes EDITS to it, not a whole
  // competing plan. Graceful fallback: if the AI proposed no suggestions, show
  // "no changes" — never re-present a full "new" plan over an existing one.
  if (recordPlan) {
    return (
      <PlanDiffStep
        suggestions={planSuggestions}
        recordPlan={recordPlan}
        planHref={planHref}
        aiPlanDetail={aiPlanDetail}
        onAcceptSuggestion={onAcceptSuggestion}
      />
    );
  }

  return (
    <Step
      no={4}
      title="Suggested plan"
      sub="Accepting versions this client's treatment plan — yours to edit, and every future session builds on it."
    >
      {aiPlanDetail}

      {editing ? (
        <div className="mt-3.5">
          <PlanEditor
            initialPlan={plan}
            busy={busy === 'modify'}
            error={error}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
            onSubmit={(edits, reason) => void modify(edits, reason)}
          />
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Act primary onClick={() => void accept()} disabled={busy !== null}>
            {busy === 'accept' ? 'Adding…' : '＋ Add to plan of care'}
          </Act>
          <Act onClick={() => setEditing(true)} disabled={busy !== null}>
            Edit &amp; accept
          </Act>
          {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
        </div>
      )}
    </Step>
  );
}

// ============================================================================
// Plan-as-diff (R3). A follow-up where an active plan already exists: the AI
// proposes typed EDITS to it, applied one at a time (each → a new plan
// version), rather than a competing full plan. Empty suggestions = "no change".
// ============================================================================

function suggestionLabel(s: ClinicalPlanSuggestion): { op: string; tone: string; text: string } {
  switch (s.type) {
    case 'ADD_GOAL':
      return { op: '+ GOAL', tone: 'ok', text: s.goal?.description ?? '' };
    case 'REVISE_GOAL':
      return {
        op: '→ GOAL',
        tone: 'accent',
        text: `Revise goal ${(s.goalIndex ?? 0) + 1}: ${s.goal?.description ?? ''}`,
      };
    case 'REMOVE_GOAL':
      return { op: '− GOAL', tone: 'warn', text: `Remove goal ${(s.goalIndex ?? 0) + 1}` };
    case 'ADJUST_DURATION':
      return {
        op: 'DURATION',
        tone: 'accent',
        text: `Change expected duration to ${s.expectedDurationSessions} sessions`,
      };
    case 'CHANGE_MODALITY':
      return { op: 'MODALITY', tone: 'accent', text: `Change modality to ${s.modality}` };
  }
}

function PlanDiffStep({
  suggestions,
  recordPlan,
  planHref,
  aiPlanDetail,
  onAcceptSuggestion,
}: {
  suggestions: ClinicalPlanSuggestion[];
  recordPlan: RecordPlan;
  planHref: string;
  aiPlanDetail: ReactNode;
  onAcceptSuggestion: (index: number) => Promise<void>;
}) {
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (i: number) => {
    setBusy(i);
    setError(null);
    try {
      await onAcceptSuggestion(i);
      setApplied((s) => new Set(s).add(i));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const planSummary = (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-accent-soft)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium capitalize">
          Plan v{recordPlan.version} · {recordPlan.modality} · {recordPlan.goalCount} goal
          {recordPlan.goalCount === 1 ? '' : 's'}
        </p>
        <a href={planHref} className="text-xs font-semibold text-[var(--color-accent)]">
          View &amp; edit on the Plan tab →
        </a>
      </div>
    </div>
  );

  if (suggestions.length === 0) {
    return (
      <Step
        no={4}
        title="Plan"
        sub="This client already has a plan — the copilot only suggests changes when a session warrants one."
      >
        {planSummary}
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          No plan changes suggested this session — the plan continues as-is. Edit it any time on the{' '}
          <a href={planHref} className="font-medium text-[var(--color-accent)]">
            Plan tab
          </a>
          .
        </p>
      </Step>
    );
  }

  const toneClass = (t: string) =>
    t === 'ok'
      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : t === 'warn'
        ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
        : 'bg-[var(--color-surface-soft)] text-[var(--color-ink-2)]';

  return (
    <Step
      no={4}
      title="Plan update"
      sub="Suggested edits to your existing plan — accept each one you agree with; each makes a new plan version. Your plan is never replaced wholesale."
    >
      {planSummary}
      <div className="mt-3 space-y-2">
        {suggestions.map((s, i) => {
          const { op, tone, text } = suggestionLabel(s);
          const isApplied = applied.has(i);
          return (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-white/40 p-3"
            >
              <span
                className={`flex-none rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${toneClass(tone)}`}
              >
                {op}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{text}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{s.rationale}</p>
                {s.type === 'ADD_GOAL' || s.type === 'REVISE_GOAL' ? (
                  <p className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                    measure: {s.goal?.measure}
                  </p>
                ) : null}
              </div>
              {isApplied ? (
                <DoneChip>On the plan of care</DoneChip>
              ) : (
                <Act primary onClick={() => void apply(i)} disabled={busy !== null}>
                  {busy === i ? 'Adding…' : '＋ Add to plan of care'}
                </Act>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-warn)]">{error}</p>}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-accent)]">
          What the AI would draft as a full plan (reference)
        </summary>
        <div className="mt-2">{aiPlanDetail}</div>
      </details>
    </Step>
  );
}

function TherapyCard({
  therapy,
  selectable = false,
  selected = false,
  onToggle,
}: {
  therapy: ClinicalRecommendedTherapy;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b className="text-sm">{therapy.name}</b>
        <span className="rounded-full border border-[var(--color-line)] px-2 py-px text-[11px] text-[var(--color-ink-3)]">
          {therapy.whenInPlan}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{therapy.rationale}</p>
    </>
  );
  if (!selectable) {
    return <div className="rounded-xl border border-[var(--color-line-soft)] p-3">{inner}</div>;
  }
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${
        selected
          ? 'border-[#d8e6de] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-line-soft)]'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1 accent-[var(--color-accent)]"
      />
      <span className="min-w-0 flex-1">{inner}</span>
    </label>
  );
}

// ============================================================================
// Step 4 (intake) — approaches become treatment-plan v1.
//
// The therapist ticks the approaches they'd start with; "Draft plan v1" opens
// the SAME PlanEditor the treatment brief uses, pre-seeded from those
// approaches (modality inferred, a sensible phase sequence, one goal per
// approach + a measurement goal). Saving creates the first versioned
// TreatmentPlan through the intake-plan route — so a plan exists from day one.
// ============================================================================

function IntakePlanStep({
  therapies,
  recordPlan,
  onDraftPlan,
}: {
  therapies: ClinicalRecommendedTherapy[];
  recordPlan: RecordPlan | null;
  onDraftPlan: (plan: ClinicalTreatmentPlan) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(therapies.map((_, i) => i)));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const seed = useMemo(
    () => seedIntakePlan(therapies.filter((_, i) => selected.has(i))),
    [therapies, selected],
  );

  const draft = async (edits: unknown, _reason: string) => {
    const plan = (edits as { treatmentPlan?: ClinicalTreatmentPlan }).treatmentPlan;
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await onDraftPlan(plan);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step
      no={4}
      title="Suggested approaches"
      sub="Tick what you'd start with — drafting opens the plan editor pre-filled, and saving creates treatment plan v1."
    >
      {therapies.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          No first-line therapies recommended — the differential is too uncertain to seed a plan.
        </p>
      ) : (
        <div className="space-y-2">
          {therapies.map((t, i) => (
            <TherapyCard
              key={i}
              therapy={t}
              selectable={!editing}
              selected={selected.has(i)}
              onToggle={() => toggle(i)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <div className="mt-3.5">
          <PlanEditor
            initialPlan={seed}
            busy={busy}
            error={error}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
            onSubmit={(edits, reason) => void draft(edits, reason)}
          />
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {recordPlan ? (
            <>
              <DoneChip>
                Plan v{recordPlan.version} in your record · {formatDate(recordPlan.confirmedAt)}
              </DoneChip>
              {therapies.length > 0 && <Act onClick={() => setEditing(true)}>Revise plan</Act>}
            </>
          ) : (
            therapies.length > 0 && (
              <>
                <Act primary onClick={() => setEditing(true)} disabled={selected.size === 0}>
                  Draft plan v1 from {selected.size} selected
                </Act>
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  You edit modality, phases, and goals before it saves.
                </span>
              </>
            )
          )}
          {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
        </div>
      )}
    </Step>
  );
}

/**
 * Seed a plan-v1 draft from the intake approaches the therapist ticked.
 * Deterministic + conservative — the therapist edits everything in the
 * PlanEditor before it persists, so this only needs to be a sensible
 * starting point that satisfies ClinicalTreatmentPlanSchema.
 */
function seedIntakePlan(approaches: ClinicalRecommendedTherapy[]): ClinicalTreatmentPlan {
  const names = approaches.map((a) => a.name);
  const joined = names.join(' ').toLowerCase();
  const modality: ClinicalTreatmentPlan['modality'] = /emdr/.test(joined)
    ? 'EMDR'
    : /cbt|cognitive|behavioural|behavioral|activation|exposure/.test(joined)
      ? 'CBT'
      : names.length === 0
        ? 'supportive'
        : 'mixed';

  const core =
    names.length > 0
      ? `Core work: ${names.slice(0, 2).join(' + ')}`.slice(0, 120)
      : 'Core treatment work';
  const phaseSequence = [
    'Safety & stabilisation',
    'Complete assessment',
    core,
    'Relapse prevention',
  ];

  const goals: ClinicalTreatmentPlan['goals'] = [
    {
      description: 'Reduce symptom severity',
      measure: 'PHQ-9 / GAD-7 trend toward reliable change',
      interventions: [],
    },
    ...names.slice(0, 4).map((n) => ({
      description: `Engage in ${n}`.slice(0, 400),
      measure: 'Therapist-rated engagement + between-session practice',
      interventions: [],
    })),
  ];

  return {
    modality,
    phaseSequence,
    goals: goals.slice(0, 8),
    expectedDurationSessions: null,
  };
}

// ============================================================================
// Step 5 — Lock in a baseline.
// ============================================================================

const ADMINISTERABLE: { key: string; label: string }[] = [
  { key: 'PHQ9', label: 'PHQ-9' },
  { key: 'GAD7', label: 'GAD-7' },
];

function BaselineStep({
  recommendedInstruments,
  instruments,
  measuresHref,
}: {
  recommendedInstruments: string[];
  instruments: RecordInstrument[];
  measuresHref: string;
}) {
  const latestByKey = useMemo(() => {
    const m = new Map<string, RecordInstrument>();
    for (const r of instruments) if (!m.has(r.instrumentKey)) m.set(r.instrumentKey, r);
    return m;
  }, [instruments]);

  const otherRecommendations = recommendedInstruments.filter(
    (k) => !ADMINISTERABLE.some((a) => a.key === normaliseInstrumentKey(k)),
  );

  // UI truth pass — once a first score exists this step is a RE-measure, not
  // a baseline. Calling a session-6 remission score a "baseline" was
  // clinically wrong copy.
  const hasAnyScore = instruments.length > 0;

  return (
    <Step
      no={5}
      title={hasAnyScore ? 'Track the measures' : 'Lock in a baseline'}
      sub={
        hasAnyScore
          ? 'Change is read against the earlier scores on file.'
          : 'Two minutes now — every later session measures change against it.'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {ADMINISTERABLE.map((a) => {
          const latest = latestByKey.get(a.key);
          return latest ? (
            <span key={a.key} className="inline-flex items-center gap-2">
              <DoneChip>
                {a.label} — {latest.score} ({latest.severity.toLowerCase()}) ·{' '}
                {formatDate(latest.administeredAt)}
              </DoneChip>
              <Link
                href={measuresHref}
                className="text-xs font-medium text-[var(--color-accent)] underline"
              >
                re-administer
              </Link>
            </span>
          ) : (
            <Link
              key={a.key}
              href={measuresHref}
              className="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              Administer {a.label}
            </Link>
          );
        })}
      </div>
      {otherRecommendations.length > 0 && (
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Also suggested: {otherRecommendations.join(', ')} (not yet administerable in-app).
        </p>
      )}
    </Step>
  );
}

// ============================================================================
// Step 6 — Wrap up. A deterministic checklist of the five decisions with
// anything outstanding linked, plus "Finish review" — the board's "save"
// moment. It's a CHECKPOINT (persists reviewedAt + audits), not a lock:
// every decision above stays revisable afterwards.
// ============================================================================

function WrapUpStep({
  isIntake,
  hasCrisis,
  crisisAcknowledged,
  record,
  reviewedAt,
  measuresHref,
  onFinish,
}: {
  isIntake: boolean;
  hasCrisis: boolean;
  crisisAcknowledged: boolean;
  record: CaseRecordSnapshot;
  reviewedAt: string | null;
  measuresHref: string;
  onFinish: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBaseline = record.instruments.some((i) =>
    ADMINISTERABLE.some((a) => a.key === i.instrumentKey),
  );

  const rows: { label: string; done: boolean; detail: string; href?: string }[] = [
    {
      label: 'Safety review',
      done: !hasCrisis || crisisAcknowledged,
      detail: !hasCrisis ? 'no flags' : crisisAcknowledged ? 'reviewed' : 'acknowledge in step 1',
    },
    {
      label: 'Working diagnosis',
      done: record.diagnoses.length > 0,
      detail:
        record.diagnoses.length > 0
          ? `${record.diagnoses.find((d) => d.isPrimary)?.icd11Code ?? record.diagnoses[0]!.icd11Code} accepted`
          : 'none accepted yet',
    },
    {
      label: 'Questions for next session',
      done: record.carriedQuestions.length > 0,
      detail:
        record.carriedQuestions.length > 0
          ? `${record.carriedQuestions.length} carried`
          : 'none carried',
    },
    {
      label: 'Treatment plan',
      done: record.plan !== null,
      detail: record.plan
        ? `v${record.plan.version} created`
        : isIntake
          ? 'draft v1 in step 4'
          : 'not accepted',
    },
    {
      label: 'Measures',
      done: hasBaseline,
      detail: hasBaseline ? 'on file' : 'administer now',
      href: hasBaseline ? undefined : measuresHref,
    },
  ];

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFinish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="relative border-t-[3px] border-t-[var(--color-accent)]">
      <div className="flex gap-3 p-5">
        <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--color-accent-soft)] text-[13px] font-bold text-[var(--color-accent)]">
          6
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-semibold">Wrap up</p>
          <p className="mb-3 mt-0.5 text-xs text-[var(--color-ink-3)]">
            Everything this review decided — finish when it reflects your judgement. You can still
            change any decision after.
          </p>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex items-center gap-2 rounded-xl border border-[var(--color-line-soft)] px-3 py-2 text-[13.5px]"
              >
                <span
                  className={r.done ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]'}
                >
                  {r.done ? '✓' : '○'}
                </span>
                <span className="font-medium">{r.label}</span>
                <span className="ml-auto text-xs text-[var(--color-ink-3)]">{r.detail}</span>
                {r.href && (
                  <Link
                    href={r.href}
                    className="text-xs font-semibold text-[var(--color-accent)] underline"
                  >
                    do it →
                  </Link>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Act primary onClick={() => void finish()} disabled={busy}>
              {busy ? 'Saving…' : reviewedAt ? 'Re-finish review' : 'Finish review'}
            </Act>
            {reviewedAt && <DoneChip>Reviewed {formatDate(reviewedAt)}</DoneChip>}
            <span className="text-[11px] text-[var(--color-ink-3)]">
              Marks this session&rsquo;s review done — decisions stay editable.
            </span>
            {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// The record lane — server truth, sticky.
// ============================================================================

function RecordLane({
  record,
  crisisFlags,
  measuresHref,
}: {
  record: CaseRecordSnapshot;
  crisisFlags: ClinicalCrisisFlag[];
  measuresHref: string;
}) {
  const highest = highestCrisisSeverity(crisisFlags);
  return (
    <Card className="border-t-[3px] border-t-[var(--color-accent)]">
      <RecBlock label="Working diagnosis">
        {record.diagnoses.length === 0 ? (
          <RecEmpty>Nothing confirmed yet — accept from the left when you&rsquo;re ready.</RecEmpty>
        ) : (
          <ul className="space-y-1.5">
            {record.diagnoses.map((d, i) => (
              <li key={i} className="text-[13.5px]">
                <b className="font-semibold">
                  {d.icd11Code} {d.icd11Label}
                </b>
                {d.isPrimary && (
                  <span className="ml-1.5 align-middle">
                    <Badge tone="accent">primary</Badge>
                  </span>
                )}
                <span className="block text-[11.5px] text-[var(--color-ink-3)]">
                  confirmed {formatDate(d.confirmedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RecBlock>
      <RecBlock label="Treatment plan">
        {record.plan === null ? (
          <RecEmpty>No plan yet. Accepting the suggestion creates v1.</RecEmpty>
        ) : (
          <p className="text-[13.5px]">
            <b className="font-semibold">
              v{record.plan.version} · <span className="capitalize">{record.plan.modality}</span>
            </b>{' '}
            · {record.plan.goalCount} goal{record.plan.goalCount === 1 ? '' : 's'}
            <span className="block text-[11.5px] text-[var(--color-ink-3)]">
              confirmed {formatDate(record.plan.confirmedAt)}
            </span>
          </p>
        )}
      </RecBlock>
      <RecBlock label="Safety record">
        {record.safetyPlanConfirmedAt ? (
          <p className="text-[13.5px]">
            <DoneChip>Safety plan on file</DoneChip>
            <span className="mt-1 block text-[11.5px] text-[var(--color-ink-3)]">
              confirmed {formatDate(record.safetyPlanConfirmedAt)}
            </span>
          </p>
        ) : crisisFlags.length > 0 ? (
          <p className="text-[13.5px]">
            <span className="inline-block rounded-full border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-2.5 py-0.5 text-xs text-[var(--color-warn)]">
              Risk flagged — {highest}
            </span>
            <span className="mt-1 block text-[11.5px] text-[var(--color-ink-3)]">
              no safety plan on file yet
            </span>
          </p>
        ) : (
          <RecEmpty>No safety concerns on file.</RecEmpty>
        )}
      </RecBlock>
      <RecBlock label="Measures">
        <div className="flex flex-wrap gap-1.5">
          {ADMINISTERABLE.map((a) => {
            const latest = record.instruments.find((r) => r.instrumentKey === a.key);
            return (
              <Link
                key={a.key}
                href={measuresHref}
                className="rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-xs text-[var(--color-ink-3)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {latest
                  ? `${a.label} — ${latest.score} · ${formatDate(latest.administeredAt)}`
                  : `○ ${a.label} — not yet`}
              </Link>
            );
          })}
        </div>
      </RecBlock>
      <RecBlock label="Next session will open with">
        {record.carriedQuestions.length === 0 ? (
          <RecEmpty>Nothing carried yet — tick questions in step 3.</RecEmpty>
        ) : (
          <div className="text-[12.5px] text-[var(--color-ink-2)]">
            <ul className="list-disc space-y-0.5 pl-4">
              {record.carriedQuestions.slice(0, 3).map((q, i) => (
                <li key={i}>{q.question}</li>
              ))}
            </ul>
            {record.carriedQuestions.length > 3 && (
              <p className="mt-1 text-[11.5px] text-[var(--color-ink-3)]">
                +{record.carriedQuestions.length - 3} more
              </p>
            )}
            <p className="mt-1 text-[11.5px] text-[var(--color-ink-3)]">
              Feeds the pre-session brief automatically.
            </p>
          </div>
        )}
      </RecBlock>
    </Card>
  );
}

function RecBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-line-soft)] p-4 last:border-b-0">
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function RecEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] italic text-[var(--color-ink-3)]">{children}</p>;
}

// ============================================================================
// Helpers.
// ============================================================================

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
    case 'other':
      return 'Unrecognised risk — review the transcript';
  }
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { month: 'short', day: 'numeric' });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "PHQ-9" / "phq9" → "PHQ9" so recommended keys match the registry. */
function normaliseInstrumentKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
