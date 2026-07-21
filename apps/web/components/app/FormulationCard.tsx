'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CaseFormulationV1,
  CycleNode,
  CycleRole,
  FormulationPrediction,
  FormulationSuggestion,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatIstDate } from '../../lib/ist';
import { isSuggestionApplied } from '../../lib/formulation-applied';

/**
 * The Session Loop (SL3) — the living case formulation, rendered in full on
 * the copilot Plan sub. The record's centre of gravity: why the suffering
 * persists (the maintaining cycle), what shaped it (the five Ps), and what
 * treatment predicts (testable predictions).
 *
 * Two modes:
 * - **Read** — narrative, the cycle chain (the link being broken is marked),
 *   the five Ps grid, predictions with status, plus any pending AI-proposed
 *   updates from the latest session (accept = new version, same route as
 *   the Close surface).
 * - **Edit** — the therapist authors the whole body directly; one save =
 *   one new version (`action: 'author'`). "Still forming" is a valid state:
 *   an empty formulation renders an invitation, not a nag.
 */

export interface FormulationCardData {
  clientId: string;
  formulation: { version: number; confirmedAt: string; body: CaseFormulationV1 } | null;
  /** Latest completed report carrying formulationSuggestions (may be null). */
  reportId: string | null;
  suggestions: FormulationSuggestion[];
}

const CYCLE_ROLES: CycleRole[] = ['TRIGGER', 'THOUGHT', 'FEELING', 'BEHAVIOUR', 'CONSEQUENCE'];

const ROLE_LABEL: Record<CycleRole, string> = {
  TRIGGER: 'Trigger',
  THOUGHT: 'Thought',
  FEELING: 'Feeling',
  BEHAVIOUR: 'Behaviour',
  CONSEQUENCE: 'Consequence',
};

const P_KEYS = ['predisposing', 'precipitating', 'perpetuating', 'protective'] as const;
type PKey = (typeof P_KEYS)[number];

const P_LABEL: Record<PKey, string> = {
  predisposing: 'Predisposing — what set the stage',
  precipitating: 'Precipitating — what tipped it',
  perpetuating: 'Perpetuating — what keeps it going',
  protective: 'Protective — what to build on',
};

const PREDICTION_STATUS: FormulationPrediction['status'][] = ['HOLDING', 'TO_TEST', 'NOT_MATCHING'];

const PREDICTION_LABEL: Record<FormulationPrediction['status'], string> = {
  HOLDING: 'holding',
  TO_TEST: 'to test',
  NOT_MATCHING: 'not matching',
};

const TARGET_LABEL: Record<FormulationSuggestion['target'], string> = {
  NARRATIVE: 'Narrative',
  CYCLE: 'Maintaining cycle',
  PREDISPOSING: 'Predisposing',
  PRECIPITATING: 'Precipitating',
  PERPETUATING: 'Perpetuating',
  PROTECTIVE: 'Protective',
  PREDICTION: 'Prediction',
};

const EMPTY_BODY: CaseFormulationV1 = {
  version: 'V1',
  narrative: '',
  cycle: [],
  fivePs: { predisposing: [], precipitating: [], perpetuating: [], protective: [] },
  predictions: [],
};

export function FormulationCard({ data }: { data: FormulationCardData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CaseFormulationV1>(data.formulation?.body ?? EMPTY_BODY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedIdx, setAcceptedIdx] = useState<Set<number>>(new Set());
  const [acceptBusy, setAcceptBusy] = useState<number | null>(null);

  const startEdit = useCallback(() => {
    setDraft(structuredClone(data.formulation?.body ?? EMPTY_BODY));
    setError(null);
    setEditing(true);
  }, [data.formulation]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    // Empty steps/entries are dropped (the schema requires non-empty text) —
    // the editor lets you add a blank row and abandon it without an error.
    const clean: CaseFormulationV1 = {
      version: 'V1',
      narrative: draft.narrative.trim(),
      cycle: draft.cycle
        .filter((n) => n.text.trim() !== '')
        .map((n) => ({ ...n, text: n.text.trim() })),
      fivePs: {
        predisposing: draft.fivePs.predisposing.map((e) => e.trim()).filter((e) => e !== ''),
        precipitating: draft.fivePs.precipitating.map((e) => e.trim()).filter((e) => e !== ''),
        perpetuating: draft.fivePs.perpetuating.map((e) => e.trim()).filter((e) => e !== ''),
        protective: draft.fivePs.protective.map((e) => e.trim()).filter((e) => e !== ''),
      },
      predictions: draft.predictions
        .filter((p) => p.text.trim() !== '')
        .map((p) => ({ ...p, text: p.text.trim() })),
    };
    try {
      const res = await fetch(`/api/v1/clients/${data.clientId}/formulation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'author', formulation: clean }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not save (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data.clientId, draft, router]);

  const acceptSuggestion = useCallback(
    async (index: number): Promise<void> => {
      if (!data.reportId) return;
      setAcceptBusy(index);
      setError(null);
      try {
        const res = await fetch(`/api/v1/clients/${data.clientId}/formulation`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'accept',
            reportId: data.reportId,
            suggestionIndex: index,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not update (${res.status})`);
        }
        setAcceptedIdx((prev) => new Set(prev).add(index));
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAcceptBusy(null);
      }
    },
    [data.clientId, data.reportId, router],
  );

  const pending = data.suggestions
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s, i }) => !acceptedIdx.has(i) && !isSuggestionApplied(data.formulation?.body ?? null, s),
    );

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Case formulation</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
            Why this persists — the understanding the plan serves. Yours; AI can only propose.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.formulation && !editing && (
            <>
              <Badge tone="accent">v{data.formulation.version}</Badge>
              <span className="text-[11px] text-[var(--color-ink-3)]">
                confirmed {formatIstDate(new Date(data.formulation.confirmedAt))}
              </span>
            </>
          )}
          {!editing && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              {data.formulation ? 'Edit' : 'Start the formulation'}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {editing ? (
          <FormulationEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setEditing(false)}
            onSave={() => void save()}
            busy={busy}
          />
        ) : data.formulation ? (
          <FormulationReadView body={data.formulation.body} />
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">
            <span className="font-medium">Still forming</span> — and that&apos;s a valid state. A
            formulation confirmed in session three beats a guess written in session one. Start it
            when the picture settles, or accept a proposed update from a session&apos;s Close
            surface.
          </p>
        )}
      </div>

      {!editing && pending.length > 0 && (
        <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            Proposed updates awaiting your call
          </p>
          <div className="mt-2 space-y-2">
            {pending.map(({ s, i }) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--color-line-soft)] bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{TARGET_LABEL[s.target]}</Badge>
                  <Badge tone="muted">{s.action === 'ADD' ? 'add' : 'revise'}</Badge>
                </div>
                <p className="mt-1.5 text-sm">{s.text}</p>
                {s.evidenceQuote && (
                  <p className="mt-1 border-l-2 border-[var(--color-line)] pl-2 text-xs italic text-[var(--color-ink-3)]">
                    &ldquo;{s.evidenceQuote}&rdquo;
                  </p>
                )}
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void acceptSuggestion(i)}
                    disabled={acceptBusy !== null}
                  >
                    {acceptBusy === i ? 'Adding…' : '＋ Add to plan of care'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Read view
// ---------------------------------------------------------------------------

function FormulationReadView({ body }: { body: CaseFormulationV1 }) {
  return (
    <div className="space-y-5">
      {body.narrative && (
        <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">{body.narrative}</p>
      )}

      {body.cycle.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            The maintaining cycle
          </p>
          <div className="flex flex-wrap items-stretch gap-2">
            {body.cycle.map((node, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className={`max-w-[220px] rounded-xl border p-2.5 ${
                    node.breaking
                      ? 'border-dashed border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                    {ROLE_LABEL[node.role]}
                    {node.breaking && (
                      <span className="ml-1.5 text-[var(--color-accent)]">· breaking here</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink)]">{node.text}</p>
                </div>
                {i < body.cycle.length - 1 && (
                  <span aria-hidden className="text-[var(--color-ink-3)]">
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {P_KEYS.some((k) => body.fivePs[k].length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {P_KEYS.map((k) =>
            body.fivePs[k].length > 0 ? (
              <div
                key={k}
                className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                  {P_LABEL[k]}
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-[var(--color-ink-2)]">
                  {body.fivePs[k].map((entry, i) => (
                    <li key={i}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}

      {body.predictions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            If this formulation is right…
          </p>
          <ul className="space-y-1.5">
            {body.predictions.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge tone={predictionTone(p.status)} className="mt-0.5 shrink-0">
                  {PREDICTION_LABEL[p.status]}
                </Badge>
                <span className="text-[var(--color-ink-2)]">{p.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
            A prediction that stops matching is the formulation asking to be revised — that&apos;s
            it working, not failing.
          </p>
        </div>
      )}
    </div>
  );
}

function predictionTone(status: FormulationPrediction['status']): 'accent' | 'warn' | 'muted' {
  if (status === 'HOLDING') return 'accent';
  if (status === 'NOT_MATCHING') return 'warn';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Editor — plain structured inputs; one save = one new version.
// ---------------------------------------------------------------------------

function FormulationEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  busy,
}: {
  draft: CaseFormulationV1;
  onChange: (next: CaseFormulationV1) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const set = (patch: Partial<CaseFormulationV1>) => onChange({ ...draft, ...patch });

  const setCycleNode = (i: number, patch: Partial<CycleNode>) => {
    const cycle = draft.cycle.map((n, j) => (j === i ? { ...n, ...patch } : n));
    // At most ONE link is marked as being broken — marking one clears others.
    if (patch.breaking) {
      cycle.forEach((n, j) => {
        if (j !== i) n.breaking = false;
      });
    }
    set({ cycle });
  };

  const setP = (k: PKey, i: number, value: string) => {
    const list = [...draft.fivePs[k]];
    list[i] = value;
    set({ fivePs: { ...draft.fivePs, [k]: list } });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Narrative
        </label>
        <textarea
          value={draft.narrative}
          onChange={(e) => set({ narrative: e.target.value })}
          maxLength={3000}
          rows={4}
          placeholder="Why this persists, in a paragraph — the story the plan serves."
          className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          The maintaining cycle
        </p>
        <div className="mt-1.5 space-y-2">
          {draft.cycle.map((node, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                value={node.role}
                onChange={(e) => setCycleNode(i, { role: e.target.value as CycleRole })}
                className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs"
                aria-label="Cycle step role"
              >
                {CYCLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={node.text}
                maxLength={300}
                onChange={(e) => setCycleNode(i, { text: e.target.value })}
                className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
                placeholder="What happens at this step"
              />
              <label className="flex items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
                <input
                  type="checkbox"
                  checked={node.breaking}
                  onChange={(e) => setCycleNode(i, { breaking: e.target.checked })}
                />
                breaking here
              </label>
              <button
                type="button"
                onClick={() => set({ cycle: draft.cycle.filter((_, j) => j !== i) })}
                className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                aria-label="Remove cycle step"
              >
                ✕
              </button>
            </div>
          ))}
          {draft.cycle.length < 8 && (
            <button
              type="button"
              onClick={() =>
                set({
                  cycle: [...draft.cycle, { role: 'TRIGGER', text: '', breaking: false }],
                })
              }
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              + Add a step
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {P_KEYS.map((k) => (
          <div key={k}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
              {P_LABEL[k]}
            </p>
            <div className="mt-1.5 space-y-1.5">
              {draft.fivePs[k].map((entry, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={entry}
                    maxLength={300}
                    onChange={(e) => setP(k, i, e.target.value)}
                    className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        fivePs: {
                          ...draft.fivePs,
                          [k]: draft.fivePs[k].filter((_, j) => j !== i),
                        },
                      })
                    }
                    className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                    aria-label={`Remove ${k} entry`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {draft.fivePs[k].length < 8 && (
                <button
                  type="button"
                  onClick={() =>
                    set({ fivePs: { ...draft.fivePs, [k]: [...draft.fivePs[k], ''] } })
                  }
                  className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
                >
                  + Add
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          If this formulation is right…
        </p>
        <div className="mt-1.5 space-y-1.5">
          {draft.predictions.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={p.text}
                maxLength={400}
                onChange={(e) =>
                  set({
                    predictions: draft.predictions.map((q, j) =>
                      j === i ? { ...q, text: e.target.value } : q,
                    ),
                  })
                }
                className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
                placeholder="What should be true in 2–3 weeks if this reading is right"
              />
              <select
                value={p.status}
                onChange={(e) =>
                  set({
                    predictions: draft.predictions.map((q, j) =>
                      j === i
                        ? { ...q, status: e.target.value as FormulationPrediction['status'] }
                        : q,
                    ),
                  })
                }
                className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs"
                aria-label="Prediction status"
              >
                {PREDICTION_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {PREDICTION_LABEL[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => set({ predictions: draft.predictions.filter((_, j) => j !== i) })}
                className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                aria-label="Remove prediction"
              >
                ✕
              </button>
            </div>
          ))}
          {draft.predictions.length < 6 && (
            <button
              type="button"
              onClick={() =>
                set({ predictions: [...draft.predictions, { text: '', status: 'TO_TEST' }] })
              }
              className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
            >
              + Add a prediction
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] pt-3">
        <Button size="sm" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm as new version'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <p className="text-[11px] text-[var(--color-ink-3)]">
          Empty steps and entries are dropped on save.
        </p>
      </div>
    </div>
  );
}
