'use client';

import { useState } from 'react';
import type { CareArc, JourneyWorkingDiagnosis } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { DischargeModal } from './DischargeModal';
import { ShareModal } from './ShareModal';

interface Props {
  arc: CareArc;
  workingDiagnosis: JourneyWorkingDiagnosis | null;
  /** True when ≥1 instrument has a reliable-change verdict (a report can be shared). */
  canShareReport: boolean;
  clientId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}

/**
 * Sprint JE3 — the Care Arc, zone [1] of the Care Engine page.
 *
 * Replaces the old EpisodeStepper + JourneyHeader. Shows the five earned
 * stages (Intake → Assessment → Formulation → Active treatment → Review)
 * with the current one highlighted, then the CURRENT stage's *exit gate* —
 * the criteria that must be met to earn the next stage, each one either
 * shown as met (with evidence) or open (with a reason + a jump-link to the
 * queue action that satisfies it). The stage is visibly earned, not asserted.
 *
 * Terminal episodes render a discharge banner instead of the strip. Discharge
 * + Share (the two write actions that used to live in JourneyHeader) sit here.
 */
export function CareArc({
  arc,
  workingDiagnosis,
  canShareReport,
  clientId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
}: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);

  const isDischarged = arc.discharged !== null;
  const currentIdx = arc.stages.findIndex((s) => s.status === 'current');
  const currentNode = currentIdx >= 0 ? arc.stages[currentIdx] : null;
  const gate = currentNode?.gate ?? null;

  return (
    <Card className="p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Care journey
          </p>
          <h2 className="mt-1 font-serif text-2xl">{currentNode?.label ?? 'Care journey'}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {arc.sessionsCompleted} session{arc.sessionsCompleted === 1 ? '' : 's'} completed
            {arc.lastSessionAt && ` · last ${formatRelative(arc.lastSessionAt)}`}
            {arc.nextSessionAt && ` · next ${formatRelative(arc.nextSessionAt)}`}
          </p>
        </div>
        {workingDiagnosis && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              {isDischarged ? 'Diagnosis at discharge' : 'Current best fit'}
              {!isDischarged && (
                <span className="ml-2 normal-case tracking-normal text-[10px] text-[var(--color-ink-3)]">
                  (provisional — may change as you learn more)
                </span>
              )}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono">{workingDiagnosis.icd11Code}</span>{' '}
              {workingDiagnosis.icd11Label}
            </p>
          </div>
        )}
      </header>

      {isDischarged && arc.discharged ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">
              {arc.discharged.status === 'TRANSFERRED' ? 'Transferred' : 'Discharged'}
            </Badge>
            <span className="text-sm text-[var(--color-ink-2)]">
              Care episode closed {formatRelative(arc.discharged.closedAt)}.
            </span>
          </div>
          {arc.discharged.closeReason && (
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">{arc.discharged.closeReason}</p>
          )}
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            Recording a new session reopens care as a fresh episode.
          </p>
        </div>
      ) : (
        <>
          {/* Stage strip — five earned stages. */}
          <ol className="mt-5 flex flex-wrap items-center gap-1.5" aria-label="Care stage">
            {arc.stages.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    s.status === 'current'
                      ? 'bg-[var(--color-accent)] text-white'
                      : s.status === 'done'
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'border border-[var(--color-line)] text-[var(--color-ink-3)]'
                  }`}
                >
                  {s.label}
                </span>
                {i < arc.stages.length - 1 && (
                  <span aria-hidden className="h-px w-3 bg-[var(--color-line)]" />
                )}
              </li>
            ))}
          </ol>

          {/* The current stage's exit gate. */}
          {gate && (
            <div className="mt-5 rounded-2xl border border-[var(--color-line-soft)] bg-white/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                  {gate.label}
                </p>
                {gate.totalCount > 1 && (
                  <p className="text-xs font-medium text-[var(--color-ink-2)] tabular-nums">
                    {gate.metCount} of {gate.totalCount} done
                  </p>
                )}
              </div>
              <ul className="mt-3 space-y-2">
                {gate.criteria.map((c) => (
                  <li key={c.key} className="flex items-start gap-2.5 text-sm">
                    <span
                      aria-hidden
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${
                        c.met
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'border border-[var(--color-line)] text-transparent'
                      }`}
                    >
                      {c.met ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          c.met
                            ? 'text-[var(--color-ink-2)]'
                            : 'font-medium text-[var(--color-ink)]'
                        }
                      >
                        {c.label}
                      </span>
                      {c.met && c.evidence && (
                        <span className="text-[var(--color-ink-3)]"> · {c.evidence}</span>
                      )}
                      {!c.met && c.why && (
                        <span className="block text-xs text-[var(--color-ink-3)]">{c.why}</span>
                      )}
                      {!c.met && c.unlocksActionId && (
                        <a
                          href={`#care-action-${c.unlocksActionId}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
                        >
                          Do next ↓
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {(canShareReport || arc.canDischarge) && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {arc.canDischarge && (
            <button
              type="button"
              onClick={() => setDischargeOpen(true)}
              className="rounded-full border border-[var(--color-line)] bg-white px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            >
              Discharge
            </button>
          )}
          {canShareReport && (
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

      {canShareReport && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          clientId={clientId}
          hasContactPhone={clientHasContactPhone}
          hasContactEmail={clientHasContactEmail}
          artefact={{ artefactType: 'PROGRESS_REPORT', clientId }}
          artefactLabel={isDischarged ? 'Final outcome report' : 'Progress report'}
        />
      )}

      <DischargeModal
        open={dischargeOpen}
        clientId={clientId}
        clientName={clientName}
        canShareReport={canShareReport}
        onClose={() => setDischargeOpen(false)}
      />
    </Card>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const future = diff < 0;
  const absDays = Math.round(Math.abs(diff) / day);
  if (absDays === 0) return 'today';
  if (absDays === 1) return future ? 'tomorrow' : 'yesterday';
  if (absDays < 30) return future ? `in ${absDays} days` : `${absDays} days ago`;
  const months = Math.round(absDays / 30);
  const label = months <= 1 ? '1 month' : `${months} months`;
  return future ? `in ${label}` : `${label} ago`;
}
