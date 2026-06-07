'use client';

import { useState } from 'react';
import type {
  ChangeVerdict,
  InstrumentChange,
  JourneyStage,
  JourneySummary,
  NextBestAction,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { DischargeModal } from './DischargeModal';
import { ShareModal } from './ShareModal';

interface Props {
  journey: JourneySummary;
  /// Sprint 20 — client display name + contact availability power the
  /// Share progress report + Discharge flows.
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}

const STAGE_LABEL: Record<JourneyStage, string> = {
  INTAKE: 'Intake',
  ASSESSMENT: 'Assessment',
  ACTIVE_TREATMENT: 'Active treatment',
  REVIEW_DUE: 'Review due',
  DISCHARGE_READY: 'Discharge ready',
  DISCHARGED: 'Discharged',
};

// The visible progression rail — DISCHARGED is terminal and rendered
// as a separate banner, not a rail step.
const STAGE_ORDER: JourneyStage[] = [
  'INTAKE',
  'ASSESSMENT',
  'ACTIVE_TREATMENT',
  'REVIEW_DUE',
  'DISCHARGE_READY',
];

const SEVERITY_LABEL: Record<string, string> = {
  minimal: 'minimal',
  mild: 'mild',
  moderate: 'moderate',
  moderately_severe: 'mod-severe',
  severe: 'severe',
};

const VERDICT_LABEL: Record<ChangeVerdict, string> = {
  reliable_improvement: 'Improving',
  no_reliable_change: 'No change',
  deterioration: 'Worsening',
};

const INSTRUMENT_LABEL: Record<string, string> = {
  PHQ9: 'PHQ-9 · depression',
  GAD7: 'GAD-7 · anxiety',
};

/**
 * Sprint 20 — Journey hub band at the top of the client detail page.
 *
 * Shows where the client is in their arc (stage), whether they're
 * measurably improving (reliable-change verdict on each screener), and
 * the single passive next-best-action. The action is dismissible
 * client-side — no nagging, no persistence (measurement-based-care
 * adoption research: passive + autonomy-respecting beats interruptive).
 */
export function JourneyHeader({
  journey,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const isDischarged = journey.stage === 'DISCHARGED';
  const stageIdx = STAGE_ORDER.indexOf(journey.stage);
  // Sprint 20 — a Progress Report needs ≥2 administrations on at least
  // one instrument (the change engine returns an entry only then).
  const canShareProgressReport = journey.instrumentChanges.length > 0;
  // Discharge is available once there's a real episode to close.
  const canDischarge = !isDischarged && journey.sessionsCompleted > 0;

  return (
    <Card className="p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Care journey
          </p>
          <h2 className="mt-1 font-serif text-2xl">{STAGE_LABEL[journey.stage]}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {journey.sessionsCompleted} session{journey.sessionsCompleted === 1 ? '' : 's'}{' '}
            completed
            {journey.lastSessionAt && ` · last ${formatRelative(journey.lastSessionAt)}`}
          </p>
        </div>
        {journey.workingDiagnosis && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Working diagnosis
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono">{journey.workingDiagnosis.icd11Code}</span>{' '}
              {journey.workingDiagnosis.icd11Label}
            </p>
          </div>
        )}
      </header>

      {/* Stage rail (active arc) or terminal discharge banner */}
      {isDischarged && journey.closedEpisode ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">
              {journey.closedEpisode.status === 'TRANSFERRED' ? 'Transferred' : 'Discharged'}
            </Badge>
            <span className="text-sm text-[var(--color-ink-2)]">
              Care episode closed {formatRelative(journey.closedEpisode.closedAt)}.
            </span>
          </div>
          {journey.closedEpisode.closeReason && (
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {journey.closedEpisode.closeReason}
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            Recording a new session reopens care as a fresh episode.
          </p>
        </div>
      ) : (
        <ol className="mt-5 flex flex-wrap items-center gap-1.5" aria-label="Care stage">
          {STAGE_ORDER.map((s, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    active
                      ? 'bg-[var(--color-accent)] text-white'
                      : done
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'border border-[var(--color-line)] text-[var(--color-ink-3)]'
                  }`}
                >
                  {STAGE_LABEL[s]}
                </span>
                {i < STAGE_ORDER.length - 1 && (
                  <span aria-hidden className="h-px w-3 bg-[var(--color-line)]" />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Outcome trend */}
      {journey.instrumentChanges.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {journey.instrumentChanges.map((c) => (
            <InstrumentTrend key={c.instrumentKey} change={c} />
          ))}
        </div>
      )}

      {(canShareProgressReport || canDischarge) && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {canDischarge && (
            <button
              type="button"
              onClick={() => setDischargeOpen(true)}
              className="rounded-full border border-[var(--color-line)] bg-white px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            >
              Discharge
            </button>
          )}
          {canShareProgressReport && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              {isDischarged ? 'Share final outcome report' : 'Share progress report'}
            </button>
          )}
        </div>
      )}

      {/* Active plan goals */}
      {journey.activePlan && journey.activePlan.goals.length > 0 && (
        <div className="mt-5">
          <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Plan goals{journey.activePlan.modality ? ` · ${journey.activePlan.modality}` : ''}
          </p>
          <ul className="mt-2 space-y-1.5">
            {journey.activePlan.goals.map((g, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                />
                <span>
                  {g.description}
                  <span className="text-[var(--color-ink-3)]"> · {g.measure}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next best action */}
      {journey.nextBestAction && !dismissed && (
        <NextActionCard action={journey.nextBestAction} onDismiss={() => setDismissed(true)} />
      )}

      {canShareProgressReport && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          clientId={journey.clientId}
          hasContactPhone={clientHasContactPhone}
          hasContactEmail={clientHasContactEmail}
          artefact={{ artefactType: 'PROGRESS_REPORT', clientId: journey.clientId }}
          artefactLabel="Progress report"
        />
      )}

      <DischargeModal
        open={dischargeOpen}
        clientId={journey.clientId}
        clientName={clientName}
        canShareReport={canShareProgressReport}
        onClose={() => setDischargeOpen(false)}
      />
    </Card>
  );
}

function InstrumentTrend({ change }: { change: InstrumentChange }) {
  const tone =
    change.verdict === 'reliable_improvement'
      ? 'accent'
      : change.verdict === 'deterioration'
        ? 'warn'
        : 'muted';
  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {INSTRUMENT_LABEL[change.instrumentKey] ?? change.instrumentKey}
        </p>
        <Badge tone={tone}>{VERDICT_LABEL[change.verdict]}</Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        <span className="font-mono text-base text-[var(--color-ink)]">{change.baselineScore}</span>
        <span className="text-[var(--color-ink-3)]"> ({severity(change.baselineSeverityKey)})</span>
        <span className="mx-1.5 text-[var(--color-ink-3)]">→</span>
        <span className="font-mono text-base text-[var(--color-ink)]">{change.latestScore}</span>
        <span className="text-[var(--color-ink-3)]"> ({severity(change.latestSeverityKey)})</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {change.isResponse && <Badge tone="accent">≥50% response</Badge>}
        {change.isRemission && <Badge tone="accent">remission</Badge>}
        <span className="text-xs text-[var(--color-ink-3)]">
          {change.administrationCount} administration{change.administrationCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function NextActionCard({ action, onDismiss }: { action: NextBestAction; onDismiss: () => void }) {
  const ring =
    action.tone === 'warn'
      ? 'border-[var(--color-warn-border)] bg-[var(--color-warn-bg)]'
      : action.tone === 'positive'
        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
        : 'border-[var(--color-line)] bg-[var(--color-surface-soft)]';
  return (
    <div className={`mt-5 rounded-2xl border p-4 ${ring}`} role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Next best action
          </p>
          <p className="mt-1 font-medium">{action.title}</p>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">{action.detail}</p>
          {action.ctaLabel && action.ctaHref && (
            <a
              href={action.ctaHref}
              className="mt-3 inline-flex items-center rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              {action.ctaLabel}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="rounded-full p-1.5 text-[var(--color-ink-3)] hover:bg-white/60"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function severity(key: string): string {
  return SEVERITY_LABEL[key] ?? key.replace(/_/g, ' ');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.round(diff / day);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}
