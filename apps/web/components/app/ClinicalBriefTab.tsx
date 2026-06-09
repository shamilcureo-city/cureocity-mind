'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClinicalAssessmentGap,
  ClinicalCrisisFlag,
  ClinicalCrisisSeverity,
  ClinicalDiagnosisCandidate,
  ClinicalRecommendedTherapy,
  ClinicalReport,
  ClinicalSectionConfirmation,
  ClinicalSectionKey,
  ClinicalTreatmentPlan,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  sessionId: string;
  initialReport: ClinicalReport | null;
}

/**
 * Sprint 13 — Clinical Brief tab. (TREATMENT / REVIEW kinds only.)
 *
 * Shows the Pass 3 ClinicalReportV1 as six per-section cards. Each
 * card lets the therapist Accept / Modify-and-Accept / Reject the AI
 * suggestion. Confirmed diagnosis + plan propagate to ClientDiagnosis
 * + TreatmentPlan cumulatively.
 *
 * Crisis flags at high/critical severity render as a top-of-page
 * banner with India hotline numbers; until acknowledged the rest of
 * the page renders with reduced opacity to nudge the therapist to
 * handle the crisis first.
 *
 * Sprint 19 — INTAKE sessions render InitialAssessmentTab instead;
 * the page picks the component based on session.kind so this tab
 * doesn't need to branch internally.
 */
export function ClinicalBriefTab({ sessionId, initialReport }: Props) {
  const [report, setReport] = useState<ClinicalReport | null>(initialReport);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        report?: ClinicalReport;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReport(body.report ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [sessionId]);

  const updateConfirmation = useCallback((next: ClinicalReport) => {
    setReport(next);
  }, []);

  // Sprint 19 — poll while Pass 3 is running in the background. The
  // generate-note route schedules Pass 3 via Next's after() callback
  // so the user lands here in PENDING; we poll until the row flips
  // to COMPLETED or FAILED so they don't have to refresh.
  useEffect(() => {
    if (report?.status !== 'PENDING') return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/clinical-analysis`, {
          cache: 'no-store',
        });
        if (res.status === 404) return;
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { report?: ClinicalReport };
        if (cancelled || !body.report) return;
        setReport(body.report);
      } catch {
        // Swallow — next tick will retry.
      }
    };
    const id = setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [report?.status, sessionId]);

  if (!report) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">No clinical brief yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          The clinical brief is generated automatically after the note finishes. If you don't see
          one, the underlying note may not have completed — generate the note first, then come back
          here.
        </p>
        <div className="mt-6">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? 'Generating…' : 'Generate clinical brief'}
          </Button>
        </div>
        {error && <p className="mt-4 text-sm text-[var(--color-warn)]">{error}</p>}
      </Card>
    );
  }

  if (report.status === 'PENDING') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">Clinical brief is being prepared…</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Generating the clinical brief in the background. This usually takes 30-60 seconds after
          the note completes. If it’s been longer, the background run may have been killed by the
          serverless cap — re-run it now.
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

  if (report.status === 'FAILED' || !report.body) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">Clinical brief generation failed</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-warn)]">
          {report.errorMessage ?? "Couldn't generate the clinical brief — try Regenerate."}
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
      report={report}
      onUpdate={updateConfirmation}
      onRegenerate={generate}
      regenerating={generating}
    />
  );
}

// ============================================================================
// Completed brief — the bulk of the UI.
// ============================================================================

function CompletedBrief({
  report,
  onUpdate,
  onRegenerate,
  regenerating,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  onRegenerate: () => void | Promise<void>;
  regenerating: boolean;
}) {
  const body = report.body!;
  const crisisAcknowledged = report.confirmations.crisis.status !== 'PENDING';
  const highestCrisis = useMemo(() => highestCrisisSeverity(body.crisisFlags), [body.crisisFlags]);
  const crisisBlocking =
    !crisisAcknowledged && (highestCrisis === 'high' || highestCrisis === 'critical');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Clinical brief</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-2)]">
            AI decision-support, generated from this session's transcript and the client's prior
            confirmed history. Review each section and accept, edit, or reject.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void onRegenerate()} disabled={regenerating}>
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </header>

      {body.crisisFlags.length > 0 && (
        <CrisisBanner
          flags={body.crisisFlags}
          confirmation={report.confirmations.crisis}
          report={report}
          onUpdate={onUpdate}
        />
      )}

      <div
        className={`space-y-6 ${crisisBlocking ? 'pointer-events-none select-none opacity-40' : ''}`}
        aria-disabled={crisisBlocking}
      >
        <DiagnosisSection
          report={report}
          onUpdate={onUpdate}
          candidates={body.diagnosisCandidates}
          primaryIndex={body.primaryDiagnosisIndex}
          confirmation={report.confirmations.diagnosis}
        />
        <AssessmentGapsSection
          report={report}
          onUpdate={onUpdate}
          gaps={body.assessmentGaps}
          confirmation={report.confirmations.gaps}
        />
        <FormulationSection
          report={report}
          onUpdate={onUpdate}
          formulation={body.formulation}
          language={body.language}
          confirmation={report.confirmations.formulation}
        />
        <PlanSection
          report={report}
          onUpdate={onUpdate}
          plan={body.treatmentPlan}
          confirmation={report.confirmations.plan}
        />
        <TherapiesSection
          report={report}
          onUpdate={onUpdate}
          therapies={body.recommendedTherapies}
          confirmation={report.confirmations.therapies}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Crisis banner — top-of-page with India hotline numbers. Mandatory
// acknowledge before the rest of the brief is interactive.
// ============================================================================

function CrisisBanner({
  flags,
  confirmation,
  report,
  onUpdate,
}: {
  flags: ClinicalCrisisFlag[];
  confirmation: ClinicalSectionConfirmation;
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
}) {
  const highest = highestCrisisSeverity(flags);
  const acknowledged = confirmation.status !== 'PENDING';
  const tone = highest === 'critical' || highest === 'high' ? 'critical' : 'soft';
  return (
    <div
      className={
        tone === 'critical'
          ? 'rounded-2xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-6'
          : 'rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6'
      }
      role="alert"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-xl">
          {tone === 'critical' ? 'Crisis flags detected' : 'Crisis review'}
        </h3>
        <Badge tone={tone === 'critical' ? 'warn' : 'muted'}>severity: {highest}</Badge>
      </div>
      <ul className="mt-3 space-y-3">
        {flags.map((f, i) => (
          <li key={i} className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-sm">{labelForCrisisKind(f.kind)}</strong>
              <Badge tone="warn">{f.severity}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">{f.recommendedAction}</p>
            {f.indicators.length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.indicators.map((q, j) => (
                  <li key={j} className="text-xs italic text-[var(--color-ink-3)]">
                    "{q.quote}" — {q.speaker} @ {formatTimestamp(q.startMs)}
                  </li>
                ))}
              </ul>
            )}
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
      <div className="mt-5 flex items-center gap-3">
        {acknowledged ? (
          <Badge tone="accent">Acknowledged {formatDate(confirmation.confirmedAt)}</Badge>
        ) : (
          <ActionButtons
            section="crisis"
            report={report}
            onUpdate={onUpdate}
            allowModify={false}
            acceptLabel="Acknowledge crisis review"
            rejectLabel="No action required (rationale required)"
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Section cards.
// ============================================================================

function DiagnosisSection({
  report,
  onUpdate,
  candidates,
  primaryIndex,
  confirmation,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  candidates: ClinicalDiagnosisCandidate[];
  primaryIndex: number | null;
  confirmation: ClinicalSectionConfirmation;
}) {
  return (
    <SectionCard
      title="Diagnosis"
      subtitle="the working diagnosis — what the AI sees as the best fit right now"
      confirmation={confirmation}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          The AI did not propose any diagnosis candidates — evidence too thin.
        </p>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c, i) => (
            <li
              key={i}
              className={`rounded-xl border p-4 ${
                primaryIndex === i
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-line-soft)] bg-white/30'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <strong className="font-mono text-sm">{c.icd11Code}</strong>{' '}
                  <span className="text-sm">{c.icd11Label}</span>
                </div>
                <div className="flex gap-2">
                  {primaryIndex === i && <Badge tone="accent">primary</Badge>}
                  <Badge tone="muted">AI confidence {(c.confidence * 100).toFixed(0)}%</Badge>
                </div>
              </div>
              <ul className="mt-3 space-y-1">
                {c.supportingEvidence.map((q, j) => (
                  <li key={j} className="text-xs italic text-[var(--color-ink-3)]">
                    "{q.quote}" — {q.speaker} @ {formatTimestamp(q.startMs)}
                  </li>
                ))}
              </ul>
              {c.gapsToFill.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    Still to assess
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-ink-2)]">
                    {c.gapsToFill.map((g, j) => (
                      <li key={j}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ActionButtons
        section="diagnosis"
        report={report}
        onUpdate={onUpdate}
        allowModify={false}
        acceptLabel="Accept diagnoses + primary"
      />
      {primaryIndex !== null && candidates[primaryIndex] && confirmation.status === 'ACCEPTED' && (
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Accepting writes {candidates.length} diagnosis row(s) to this client's record; the row
          marked primary above replaces any prior primary diagnosis.
        </p>
      )}
    </SectionCard>
  );
}

function AssessmentGapsSection({
  report,
  onUpdate,
  gaps,
  confirmation,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  gaps: ClinicalAssessmentGap[];
  confirmation: ClinicalSectionConfirmation;
}) {
  return (
    <SectionCard title="Assessment gaps" confirmation={confirmation}>
      {gaps.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          No open assessment questions — diagnosis can proceed.
        </p>
      ) : (
        <ul className="space-y-3">
          {gaps.map((g, i) => (
            <li key={i} className="rounded-xl border border-[var(--color-line-soft)] p-4">
              <p className="text-sm font-medium">{g.question}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">{g.rationale}</p>
            </li>
          ))}
        </ul>
      )}
      <ActionButtons section="gaps" report={report} onUpdate={onUpdate} />
    </SectionCard>
  );
}

function FormulationSection({
  report,
  onUpdate,
  formulation,
  language,
  confirmation,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  formulation: string;
  language: string;
  confirmation: ClinicalSectionConfirmation;
}) {
  return (
    <SectionCard
      title="Case formulation"
      confirmation={confirmation}
      subtitle={language !== 'en' ? `language: ${language}` : undefined}
    >
      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
        {formulation}
      </p>
      <ActionButtons section="formulation" report={report} onUpdate={onUpdate} />
    </SectionCard>
  );
}

function PlanSection({
  report,
  onUpdate,
  plan,
  confirmation,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  plan: ClinicalTreatmentPlan;
  confirmation: ClinicalSectionConfirmation;
}) {
  return (
    <SectionCard title="Treatment plan" confirmation={confirmation}>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Modality</dt>
          <dd className="mt-1 capitalize">{plan.modality}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Expected duration
          </dt>
          <dd className="mt-1">
            {plan.expectedDurationSessions !== null
              ? `${plan.expectedDurationSessions} sessions`
              : 'too uncertain'}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Phase sequence</p>
        <ol className="mt-2 flex flex-wrap gap-2 text-sm">
          {plan.phaseSequence.map((p, i) => (
            <li
              key={i}
              className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[var(--color-ink-2)]"
            >
              {i + 1}. {p}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Goals</p>
        <ul className="mt-2 space-y-2">
          {plan.goals.map((g, i) => (
            <li
              key={i}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-3"
            >
              <p className="text-sm font-medium">{g.description}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">measure: {g.measure}</p>
            </li>
          ))}
        </ul>
      </div>
      <ActionButtons
        section="plan"
        report={report}
        onUpdate={onUpdate}
        allowModify={false}
        acceptLabel="Accept plan + version it"
      />
      {confirmation.status === 'ACCEPTED' && (
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Accepting bumps this client's TreatmentPlan version and supersedes the prior active plan.
        </p>
      )}
    </SectionCard>
  );
}

function TherapiesSection({
  report,
  onUpdate,
  therapies,
  confirmation,
}: {
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  therapies: ClinicalRecommendedTherapy[];
  confirmation: ClinicalSectionConfirmation;
}) {
  return (
    <SectionCard title="Recommended therapies" confirmation={confirmation}>
      {therapies.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          No specific therapies recommended for this session.
        </p>
      ) : (
        <ul className="space-y-3">
          {therapies.map((t, i) => (
            <li
              key={i}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-sm">{t.name}</strong>
                <Badge tone="muted">when: {t.whenInPlan}</Badge>
              </div>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">{t.rationale}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">{t.evidenceSummary}</p>
            </li>
          ))}
        </ul>
      )}
      <ActionButtons section="therapies" report={report} onUpdate={onUpdate} />
    </SectionCard>
  );
}

// ============================================================================
// Generic section card + action buttons.
// ============================================================================

function SectionCard({
  title,
  subtitle,
  confirmation,
  children,
}: {
  title: string;
  subtitle?: string;
  confirmation: ClinicalSectionConfirmation;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl">{title}</h3>
          {subtitle && (
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{subtitle}</p>
          )}
        </div>
        <ConfirmationBadge confirmation={confirmation} />
      </header>
      <p className="mb-4 text-xs italic text-[var(--color-ink-3)]">
        AI suggestion. You are the clinician. Verify before acting.
      </p>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function ConfirmationBadge({ confirmation }: { confirmation: ClinicalSectionConfirmation }) {
  switch (confirmation.status) {
    case 'ACCEPTED':
      return <Badge tone="accent">accepted {formatDate(confirmation.confirmedAt)}</Badge>;
    case 'MODIFIED':
      return <Badge tone="accent">modified {formatDate(confirmation.confirmedAt)}</Badge>;
    case 'REJECTED':
      return <Badge tone="muted">rejected {formatDate(confirmation.confirmedAt)}</Badge>;
    default:
      return <Badge tone="muted">pending</Badge>;
  }
}

function ActionButtons({
  section,
  report,
  onUpdate,
  allowModify = true,
  acceptLabel = 'Accept',
  rejectLabel = 'Reject',
}: {
  section: ClinicalSectionKey;
  report: ClinicalReport;
  onUpdate: (next: ClinicalReport) => void;
  allowModify?: boolean;
  acceptLabel?: string;
  rejectLabel?: string;
}) {
  const [busy, setBusy] = useState<null | 'accept' | 'reject'>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (action: 'accept' | 'reject') => {
      setBusy(action);
      setError(null);
      try {
        const body: Record<string, unknown> = { action };
        if (action === 'reject') body['reason'] = reason;
        const res = await fetch(`/api/v1/clinical-reports/${report.id}/sections/${section}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          report?: ClinicalReport;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (data.report) onUpdate(data.report);
        setShowReject(false);
        setReason('');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [report.id, section, reason, onUpdate],
  );

  const confirmed = report.confirmations[section].status !== 'PENDING';

  return (
    <div className="mt-4 border-t border-[var(--color-line-soft)] pt-4">
      {!confirmed && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void submit('accept')} disabled={busy !== null}>
            {busy === 'accept' ? 'Saving…' : acceptLabel}
          </Button>
          {allowModify && (
            <Button
              variant="secondary"
              onClick={() => alert('Inline edit lands in S13 PR2 — accept or reject for now.')}
              disabled={busy !== null}
            >
              Edit and accept
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => setShowReject((s) => !s)}
            disabled={busy !== null}
          >
            {showReject ? 'Cancel' : rejectLabel}
          </Button>
        </div>
      )}
      {showReject && (
        <div className="mt-3 space-y-2">
          <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Reason (required)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
            placeholder="What's wrong with this AI suggestion?"
          />
          <div>
            <Button
              variant="secondary"
              onClick={() => void submit('reject')}
              disabled={busy !== null || reason.trim().length === 0}
            >
              {busy === 'reject' ? 'Saving…' : 'Submit rejection'}
            </Button>
          </div>
        </div>
      )}
      {confirmed && (
        <p className="text-xs text-[var(--color-ink-3)]">
          {report.confirmations[section].reason && (
            <>Reason: {report.confirmations[section].reason}</>
          )}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-[var(--color-warn)]">{error}</p>}
    </div>
  );
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
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
