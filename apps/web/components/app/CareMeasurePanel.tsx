'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CareMeasure,
  ChangeVerdict,
  InstrumentResponse,
  JourneyActivePlan,
  TreatmentGoalStatus,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AffectCard } from './AffectCard';
import { ShareModal } from './ShareModal';
import { severityLabel, phq9Plain, gad7Plain } from '../../lib/instrument-plain-language';

interface CatalogItem {
  id: string;
  number: number;
  text: { en: string };
}

interface CatalogScale {
  value: number;
  label: { en: string };
}

interface Instrument {
  key: 'PHQ9' | 'GAD7';
  title: { en: string };
  recallWindow: { en: string };
  items: CatalogItem[];
  scale: CatalogScale[];
  riskItemNumber: number | null;
}

interface Props {
  measures: CareMeasure[];
  activePlan: JourneyActivePlan | null;
  clientId: string;
  /** Discharged — goals are read-only. */
  disabled: boolean;
  /** TS7.4 — contact availability for the one-tap "Send now" check-in. */
  hasContactPhone?: boolean;
  hasContactEmail?: boolean;
}

const VERDICT_LABEL: Record<ChangeVerdict, string> = {
  reliable_improvement: 'Improving',
  no_reliable_change: 'No reliable change',
  deterioration: 'Worsening',
};

const VERDICT_TONE: Record<ChangeVerdict, 'accent' | 'warn' | 'muted'> = {
  reliable_improvement: 'accent',
  no_reliable_change: 'muted',
  deterioration: 'warn',
};

/**
 * Sprint JE6 — "Is it working?": ONE card for the whole measurement story.
 *
 * The old page showed scores in three places (two measure mini-cards, a
 * separate "Symptom checklists" runner card with its own header + full
 * history, and again in the pre-session brief). Here each tracked instrument
 * is a single row — verdict-first (baseline → latest → verdict + due badge)
 * with the administration form expanding INLINE under its row. Submitting
 * calls router.refresh(), so the board's gate/queue above update immediately
 * (the old runner left them stale). History folds behind one toggle; the
 * plan's goals and the affect baseline follow as subsections.
 */
export function CareMeasurePanel({
  measures,
  activePlan,
  clientId,
  disabled,
  hasContactPhone = false,
  hasContactEmail = false,
}: Props) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Instrument[]>([]);
  // TS7.4 — one-tap "Send now": per-instrument busy / sent / failed state,
  // plus the ShareModal fallback for when no channel can be resolved.
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<Record<string, string>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [fallbackShare, setFallbackShare] = useState<{
    instrumentKey: 'PHQ9' | 'GAD7';
    label: string;
  } | null>(null);

  // TS7.4 — one tap sends the check-in link over the channel the therapist
  // last used for this client (share-sheet memory), else the preferred
  // contact. No usable channel → the full share sheet opens instead (it
  // owns the portal-link copy UX).
  async function sendNow(instrumentKey: 'PHQ9' | 'GAD7', label: string): Promise<void> {
    if (sendingKey) return;
    setSendError(null);
    let channels: string[] = [];
    try {
      const raw = window.localStorage.getItem(`cm.sharePrefs.${clientId}`);
      const prefs = raw ? (JSON.parse(raw) as { channels?: string[] }) : null;
      if (Array.isArray(prefs?.channels)) {
        channels = prefs.channels.filter(
          (c) => (c === 'WHATSAPP' && hasContactPhone) || (c === 'EMAIL' && hasContactEmail),
        );
      }
    } catch {
      // prefs unavailable — fall through to contact order
    }
    if (channels.length === 0) {
      if (hasContactPhone) channels = ['WHATSAPP'];
      else if (hasContactEmail) channels = ['EMAIL'];
    }
    if (channels.length === 0) {
      setFallbackShare({ instrumentKey, label });
      return;
    }
    setSendingKey(instrumentKey);
    try {
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels,
          artefact: { artefactType: 'INSTRUMENT_CHECKIN', clientId, instrumentKey },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: { channel: string; status: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Send failed (${res.status})`);
      const delivered = (data.results ?? []).filter((r) => r.status !== 'FAILED');
      if (delivered.length === 0) {
        throw new Error('Nothing was delivered — pick a channel instead.');
      }
      setSentMsg((m) => ({
        ...m,
        [instrumentKey]: `✓ Check-in sent via ${delivered
          .map((r) => channelLabel(r.channel))
          .join(' + ')}`,
      }));
    } catch (e) {
      setSendError((e as Error).message);
      setFallbackShare({ instrumentKey, label });
    } finally {
      setSendingKey(null);
    }
  }
  const [history, setHistory] = useState<InstrumentResponse[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // The score route returns `risk: true` when the suicidality item (PHQ-9
  // item 9) is endorsed — surfaced as a prominent, dismissible alert.
  const [riskAlert, setRiskAlert] = useState<{
    instrumentKey: string;
    itemNumber: number | null;
  } | null>(null);

  const loadHistory = useCallback(async () => {
    const res = await fetch(`/api/v1/clients/${clientId}/instruments`, { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { items: InstrumentResponse[] };
    setHistory(body.items);
  }, [clientId]);

  useEffect(() => {
    void (async () => {
      const [c] = await Promise.all([
        fetch('/api/v1/instruments', { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({ items: [] as Instrument[] })),
        loadHistory(),
      ]);
      setCatalog((c as { items: Instrument[] }).items);
    })();
  }, [loadHistory]);

  const latestByKey = useMemo(() => {
    const m = new Map<string, InstrumentResponse>();
    for (const h of history) {
      if (!m.has(h.instrumentKey)) m.set(h.instrumentKey, h);
    }
    return m;
  }, [history]);

  const submit = useCallback(async () => {
    const active = catalog.find((c) => c.key === activeKey);
    if (!active) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/instruments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrumentKey: active.key, responses }),
      });
      const body = (await res.json().catch(() => ({}))) as { risk?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRiskAlert(
        body.risk ? { instrumentKey: active.key, itemNumber: active.riskItemNumber } : null,
      );
      setActiveKey(null);
      setResponses({});
      await loadHistory();
      // The score changes the engine's facts (baseline / due / verdict) —
      // refresh so the board's checklist above updates in the same view.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [activeKey, catalog, clientId, loadHistory, responses, router]);

  return (
    <div id="care-measures" className="scroll-mt-24">
      <Card className="p-6">
        <header>
          <h2 className="font-serif text-2xl">Is it working?</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Scores, plan goals and emotional tone — everything that shows change lives here.
          </p>
        </header>

        {riskAlert && (
          <aside
            role="alert"
            className="mt-4 rounded-2xl border border-[#9f1f1f] bg-[#fbe1de] p-4 text-[#7f1010]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-lg">
                  Risk item endorsed —{' '}
                  {riskItemLabel(riskAlert.instrumentKey, riskAlert.itemNumber)}
                </p>
                <p className="mt-1 text-sm">
                  The client endorsed thoughts of self-harm. Conduct a full risk assessment and
                  review the safety plan before the session ends.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRiskAlert(null)}
                aria-label="dismiss risk alert"
                className="shrink-0 text-sm text-[#7f1010]/70 hover:text-[#7f1010]"
              >
                ✕
              </button>
            </div>
          </aside>
        )}

        {/* One row per tracked instrument; the form expands inline. */}
        <ul className="mt-4 space-y-3">
          {measures.map((m) => {
            const cat = catalog.find((c) => c.key === m.instrumentKey);
            const latest = latestByKey.get(m.instrumentKey);
            const isActive = activeKey === m.instrumentKey;
            return (
              <li
                key={m.instrumentKey}
                className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{m.label}</p>
                    <Badge
                      tone={
                        m.dueState === 'DUE_NOW'
                          ? 'warn'
                          : m.dueState === 'DUE_SOON'
                            ? 'accent'
                            : 'muted'
                      }
                    >
                      {m.dueLabel}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* TS7.4 — due today means send today: one tap fires the
                        check-in link over the remembered / preferred channel. */}
                    {!disabled && m.dueState !== 'ON_TRACK' && !sentMsg[m.instrumentKey] && (
                      <Button
                        onClick={() => void sendNow(m.instrumentKey, m.label)}
                        disabled={sendingKey !== null}
                      >
                        {sendingKey === m.instrumentKey ? 'Sending…' : 'Send now ▸'}
                      </Button>
                    )}
                    {cat && !disabled && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setActiveKey(isActive ? null : m.instrumentKey);
                          setResponses({});
                          setError(null);
                        }}
                      >
                        {isActive ? 'Cancel' : 'Do it in-session'}
                      </Button>
                    )}
                  </div>
                </div>
                {sentMsg[m.instrumentKey] && (
                  <p className="mt-2 text-xs font-medium text-[var(--color-accent)]">
                    {sentMsg[m.instrumentKey]} — the score lands here when they finish.
                  </p>
                )}
                {sendError &&
                  sendingKey === null &&
                  fallbackShare?.instrumentKey === m.instrumentKey && (
                    <p className="mt-2 text-xs text-[var(--color-warn)]" role="alert">
                      {sendError}
                    </p>
                  )}

                {m.verdict !== null && m.baselineScore !== null ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-lg tabular-nums">{m.baselineScore}</span>
                      <span aria-hidden className="text-[var(--color-ink-3)]">
                        →
                      </span>
                      <span className="font-mono text-lg tabular-nums">{m.latestScore}</span>
                      {m.delta !== null && (
                        <span className="text-xs text-[var(--color-ink-3)] tabular-nums">
                          ({m.delta > 0 ? '+' : ''}
                          {m.delta})
                        </span>
                      )}
                      <Badge tone={VERDICT_TONE[m.verdict]}>{VERDICT_LABEL[m.verdict]}</Badge>
                      {m.isResponse && (
                        <span title="≥50% reduction from baseline — a clinically meaningful response.">
                          <Badge tone="accent">Big improvement</Badge>
                        </span>
                      )}
                      {m.isRemission && (
                        <span title="At or below the symptom-free cutoff.">
                          <Badge tone="accent">In remission</Badge>
                        </span>
                      )}
                    </div>
                    {latest && (
                      <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                        {plainFor(m.instrumentKey, latest.score, latest.severity)} ·{' '}
                        {m.administrationCount} administration
                        {m.administrationCount === 1 ? '' : 's'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                    {m.administrationCount === 0
                      ? 'No baseline yet — the first score becomes the starting point every later one is measured against.'
                      : `Latest score ${latest ? `${latest.score} (${severityLabel(latest.severity)})` : 'recorded'} — one more administration gives the first change verdict.`}
                  </p>
                )}

                {/* Inline administration form. */}
                {isActive && cat && (
                  <div className="mt-4 border-t border-[var(--color-line-soft)] pt-4">
                    <p className="text-sm text-[var(--color-ink-2)]">{cat.recallWindow.en}</p>
                    <ol className="mt-3 space-y-4">
                      {cat.items.map((it) => (
                        <li
                          key={it.id}
                          className="rounded-xl border border-[var(--color-line-soft)] bg-white/50 p-3"
                        >
                          <p className="text-sm font-medium">
                            {it.number}. {it.text.en}
                          </p>
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                            {cat.scale.map((s) => {
                              const selected = responses[it.id] === s.value;
                              return (
                                <button
                                  key={s.value}
                                  type="button"
                                  onClick={() => setResponses((r) => ({ ...r, [it.id]: s.value }))}
                                  className={`rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                                    selected
                                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                                      : 'border-[var(--color-line-soft)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
                                  }`}
                                >
                                  <span className="mr-2 font-mono text-xs text-[var(--color-ink-3)]">
                                    {s.value}
                                  </span>
                                  {s.label.en}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      ))}
                    </ol>
                    {error && (
                      <p className="mt-3 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
                        {error}
                      </p>
                    )}
                    <div className="mt-4 flex justify-end">
                      <Button
                        onClick={() => void submit()}
                        disabled={
                          cat.items.some((it) => responses[it.id] === undefined) || submitting
                        }
                      >
                        {submitting ? 'Scoring…' : 'Score + save'}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* History — folded; the rows above already show the live picture. */}
        {history.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              {showHistory ? 'Hide history' : `History (${history.length})`}
            </button>
            {showHistory && (
              <ul className="mt-2 divide-y divide-[var(--color-line-soft)] border-y border-[var(--color-line-soft)]">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-2 text-sm"
                  >
                    <span>
                      <span className="font-mono text-xs text-[var(--color-ink-3)]">
                        {h.instrumentKey}
                      </span>
                      <span className="ml-2">
                        {h.score} · {severityLabel(h.severity)}
                      </span>
                      {h.administrationMode === 'SELF' && (
                        <Badge tone="muted" className="ml-1.5">
                          self check-in
                        </Badge>
                      )}
                    </span>
                    <span className="text-xs text-[var(--color-ink-3)]">
                      {new Date(h.administeredAt).toLocaleDateString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Plan goals. */}
        {activePlan && activePlan.goals.length > 0 && (
          <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Plan goals{activePlan.modality ? ` · ${activePlan.modality}` : ''}
              </p>
              <p className="text-xs font-medium text-[var(--color-ink-2)]">
                {goalBreakdown(activePlan.goals)}
              </p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {activePlan.goals.map((g) => (
                <GoalRow
                  key={g.index}
                  planId={activePlan.id}
                  index={g.index}
                  description={g.description}
                  measure={g.measure}
                  status={g.status}
                  disabled={disabled}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Affect baseline. */}
        <div className="mt-5">
          <AffectCard clientId={clientId} />
        </div>
      </Card>

      {/* TS7.4 — fallback when one-tap can't resolve a channel (or a send
          failed): the full share sheet, which also handles portal-link copy. */}
      {fallbackShare && (
        <ShareModal
          open
          onClose={() => setFallbackShare(null)}
          clientId={clientId}
          hasContactPhone={hasContactPhone}
          hasContactEmail={hasContactEmail}
          artefact={{
            artefactType: 'INSTRUMENT_CHECKIN',
            clientId,
            instrumentKey: fallbackShare.instrumentKey,
          }}
          artefactLabel={`Check-in · ${fallbackShare.label}`}
        />
      )}
    </div>
  );
}

function channelLabel(channel: string): string {
  if (channel === 'WHATSAPP') return 'WhatsApp';
  if (channel === 'EMAIL') return 'email';
  return 'portal link';
}

function riskItemLabel(instrumentKey: string, itemNumber: number | null): string {
  const label =
    instrumentKey === 'PHQ9' ? 'PHQ-9' : instrumentKey === 'GAD7' ? 'GAD-7' : instrumentKey;
  const item = itemNumber ? `${label} item ${itemNumber}` : label;
  if (instrumentKey === 'PHQ9' && itemNumber === 9) return `${item} (thoughts of self-harm)`;
  return item;
}

function plainFor(instrumentKey: string, score: number, severity: string): string {
  return instrumentKey === 'GAD7' ? gad7Plain(score, severity) : phq9Plain(score, severity);
}

const GOAL_STATUS_LABEL: Record<TreatmentGoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  ACHIEVED: 'Achieved',
};

// Click cycles the status; the order matches a goal's natural lifecycle.
const GOAL_STATUS_CYCLE: Record<TreatmentGoalStatus, TreatmentGoalStatus> = {
  NOT_STARTED: 'IN_PROGRESS',
  IN_PROGRESS: 'ACHIEVED',
  ACHIEVED: 'NOT_STARTED',
};

function GoalRow({
  planId,
  index,
  description,
  measure,
  status,
  disabled,
}: {
  planId: string;
  index: number;
  description: string;
  measure: string;
  status: TreatmentGoalStatus;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<TreatmentGoalStatus>(status);

  async function cycle(): Promise<void> {
    if (disabled || busy) return;
    const next = GOAL_STATUS_CYCLE[optimistic];
    setOptimistic(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/treatment-plans/${planId}/goals/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setOptimistic(status); // revert
        return;
      }
      router.refresh();
    } catch {
      setOptimistic(status);
    } finally {
      setBusy(false);
    }
  }

  const dot =
    optimistic === 'ACHIEVED'
      ? 'bg-[var(--color-accent)]'
      : optimistic === 'IN_PROGRESS'
        ? 'bg-[var(--color-warn)]'
        : 'border border-[var(--color-line)] bg-transparent';

  return (
    <li className="flex items-start gap-2 text-sm">
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={disabled || busy}
        aria-label={
          disabled
            ? `Goal status: ${GOAL_STATUS_LABEL[optimistic]}`
            : `Goal status: ${GOAL_STATUS_LABEL[optimistic]} (click to change)`
        }
        className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full disabled:cursor-default"
      >
        <span aria-hidden className={`h-3 w-3 rounded-full ${dot}`}>
          {optimistic === 'ACHIEVED' && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3"
            >
              <path d="M5 12l5 5 9-9" />
            </svg>
          )}
        </span>
      </button>
      <span className={optimistic === 'ACHIEVED' ? 'text-[var(--color-ink-3)] line-through' : ''}>
        {description}
        <span className="text-[var(--color-ink-3)]"> · {measure}</span>
        {optimistic !== 'NOT_STARTED' && (
          <span className="ml-1.5 text-xs text-[var(--color-ink-3)]">
            ({GOAL_STATUS_LABEL[optimistic]})
          </span>
        )}
      </span>
    </li>
  );
}

// Plain "N achieved · N in progress · N not started" readout.
function goalBreakdown(goals: { status: TreatmentGoalStatus }[]): string {
  const achieved = goals.filter((g) => g.status === 'ACHIEVED').length;
  const inProgress = goals.filter((g) => g.status === 'IN_PROGRESS').length;
  const notStarted = goals.filter((g) => g.status === 'NOT_STARTED').length;
  return `${achieved} achieved · ${inProgress} in progress · ${notStarted} not started`;
}
