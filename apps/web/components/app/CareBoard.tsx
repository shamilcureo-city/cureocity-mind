'use client';

import { useState } from 'react';
import type {
  CareAction,
  CareActionPriority,
  CareArc,
  JourneyWorkingDiagnosis,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { DischargeModal } from './DischargeModal';
import { ShareModal } from './ShareModal';

interface Props {
  arc: CareArc;
  queue: CareAction[];
  workingDiagnosis: JourneyWorkingDiagnosis | null;
  /** True when ≥1 instrument has a reliable-change verdict (a report can be shared). */
  canShareReport: boolean;
  clientId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  /** Link to the Plan tab — the one home for diagnosis + plan (R1). */
  planHref?: string;
}

const PRIORITY_META: Record<CareActionPriority, { label: string; chip: string }> = {
  SAFETY: { label: 'Safety', chip: 'bg-[#a03b34] text-white' },
  MEASURE: { label: 'Measure', chip: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' },
  DIAGNOSE: { label: 'Diagnose', chip: 'bg-[#f6efdc] text-[#8a7434]' },
  PLAN: { label: 'Plan', chip: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' },
  OUTCOME: {
    label: 'Outcome',
    chip: 'bg-white text-[var(--color-ink-3)] border border-[var(--color-line)]',
  },
};

const WHEN_LABEL: Record<CareAction['when'], string> = {
  this_session: 'this session',
  next_session: 'next session',
};

/**
 * Sprint JE6 — the Care Board: zone [1] of the Journey page, and the fix for
 * its central duplication. The old page rendered the current stage's exit
 * gate ("safety ✗ · baseline ✗", linking down) AND a separate "Do next"
 * queue ("1. safety plan · 2. administer PHQ-9", linking back up) — two
 * boxes stating the same facts with circular jump-links.
 *
 * Here they are ONE checklist. Each gate criterion renders as a row: met →
 * a ✓ with its evidence; open → the queue action that satisfies it, inline
 * (title, why, CTA). Queue actions no criterion references (re-measure,
 * plan review, discharge) follow under "Also". The stage strip above shows
 * where this earns you; Discharge + Share sit at the bottom as before.
 */
export function CareBoard({
  arc,
  queue,
  workingDiagnosis,
  canShareReport,
  clientId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  planHref,
}: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);

  const isDischarged = arc.discharged !== null;
  const currentNode = arc.stages.find((s) => s.status === 'current') ?? null;
  const gate = currentNode?.gate ?? null;

  // Split the queue: actions a gate criterion references render inside that
  // criterion's row; the rest render under "Also".
  const referenced = new Set(
    (gate?.criteria ?? []).map((c) => c.unlocksActionId).filter((id): id is string => id !== null),
  );
  const actionById = new Map(queue.map((a) => [a.id, a]));
  const alsoDue = queue.filter((a) => !referenced.has(a.id));

  return (
    <Card className="p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Treatment arc
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {isDischarged ? 'Episode closed' : (currentNode?.label ?? 'Treatment arc')}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {arc.sessionsCompleted} session{arc.sessionsCompleted === 1 ? '' : 's'} completed
            {arc.lastSessionAt && ` · last ${formatRelative(arc.lastSessionAt)}`}
          </p>
        </div>
        {/* Diagnosis is shown once, as a pointer to its one home (the Plan tab),
            not restated with a competing "provisional" framing. (R1 · C·4/C·17) */}
        {workingDiagnosis && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              {isDischarged ? 'Diagnosis at discharge' : 'Working diagnosis'}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono">{workingDiagnosis.icd11Code}</span>{' '}
              {workingDiagnosis.icd11Label}
            </p>
            {planHref && !isDischarged && (
              <a
                href={planHref}
                className="text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                diagnosis + plan live on Plan ↗
              </a>
            )}
          </div>
        )}
      </header>

      {isDischarged && arc.discharged ? (
        <>
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
          {/* Post-discharge actions (a late safety flag, the outcome report). */}
          {queue.length > 0 && (
            <ul className="mt-4 space-y-2.5">
              {queue.map((a) => (
                <ActionRow key={a.id} action={a} />
              ))}
            </ul>
          )}
        </>
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

          {/* The checklist: gate criteria as rows; open ones ARE the action. */}
          {gate && (
            <div className="mt-5">
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
              <ul className="mt-3 space-y-2.5">
                {gate.criteria.map((c) => {
                  const action = c.unlocksActionId ? actionById.get(c.unlocksActionId) : undefined;
                  if (c.met) {
                    return (
                      <li key={c.key} className="flex items-start gap-2.5 text-sm">
                        <Tick met />
                        <span className="min-w-0 flex-1 text-[var(--color-ink-2)]">
                          {c.label}
                          {c.evidence && (
                            <span className="text-[var(--color-ink-3)]"> · {c.evidence}</span>
                          )}
                        </span>
                      </li>
                    );
                  }
                  if (action) {
                    return (
                      <li key={c.key} className="flex items-start gap-2.5">
                        <Tick />
                        <div className="min-w-0 flex-1">
                          <ActionBody action={action} earns={c.label} />
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={c.key} className="flex items-start gap-2.5 text-sm">
                      <Tick />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[var(--color-ink)]">{c.label}</span>
                        {c.why && (
                          <span className="block text-xs text-[var(--color-ink-3)]">{c.why}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Actions not tied to the gate (re-measure, plan review, outcome). */}
          {alsoDue.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Also
              </p>
              <ul className="mt-2 space-y-2.5">
                {alsoDue.map((a) => (
                  <ActionRow key={a.id} action={a} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {(canShareReport || arc.canDischarge) && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
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

/** A standalone action row (post-discharge list + the "Also" section). */
function ActionRow({ action }: { action: CareAction }) {
  return (
    <li className="flex items-start gap-2.5">
      <Tick />
      <div className="min-w-0 flex-1">
        <ActionBody action={action} earns={null} />
      </div>
    </li>
  );
}

/** The action content shared by checklist rows and "Also" rows. */
function ActionBody({ action, earns }: { action: CareAction; earns: string | null }) {
  const meta = PRIORITY_META[action.priority];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--color-ink)]">{action.title}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}
        >
          {meta.label}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
          {WHEN_LABEL[action.when]}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">{action.why}</p>
      {earns && <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">Moves to: {earns}</p>}
      {action.ctaLabel && action.ctaHref && (
        <a
          href={action.ctaHref}
          className="mt-2 inline-flex items-center rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          {action.ctaLabel}
        </a>
      )}
    </div>
  );
}

function Tick({ met = false }: { met?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${
        met
          ? 'bg-[var(--color-accent)] text-white'
          : 'border border-[var(--color-line)] text-transparent'
      }`}
    >
      {met ? '✓' : ''}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const absDays = Math.round(Math.abs(diff) / day);
  if (absDays === 0) return 'today';
  if (absDays === 1) return diff < 0 ? 'tomorrow' : 'yesterday';
  if (absDays < 30) return diff < 0 ? `in ${absDays} days` : `${absDays} days ago`;
  const months = Math.round(absDays / 30);
  const label = months <= 1 ? '1 month' : `${months} months`;
  return diff < 0 ? `in ${label}` : `${label} ago`;
}
