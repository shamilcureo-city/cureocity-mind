'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DifferentialResponseSchema,
  RxPadResponseSchema,
  type RxPadDraft,
  type RxPadPatchOp,
  type SuggestedPlan,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Input, Label } from '../ui/Field';

/**
 * Sprint DS10-B — the plan composer: two plans, one sign-off.
 *
 *   LEFT  "Your plan"    — the draft Rx pad. Dictated orders land here
 *                          automatically; the doctor confirms pending meds,
 *                          removes rows, or adds items manually.
 *   RIGHT "AI suggests"  — the differential's suggested plan (tests, meds,
 *                          advice, follow-up, exam steps). NOTHING crosses
 *                          into the pad without an explicit Add tap; every
 *                          adoption is audited with its provenance.
 *
 * The pad is what the DS5-fu sign flow snapshots into the signed Rx
 * (confirmed meds only) → the letterhead PDF + the patient share.
 */

type DiffState =
  | { kind: 'loading' }
  | { kind: 'ready'; plan: SuggestedPlan; workupFallback: string[] }
  | { kind: 'none' }; // failed or nothing to suggest — the pad still works

export function PlanComposer({
  sessionId,
  signed,
  onPadChange,
}: {
  sessionId: string;
  signed: boolean;
  /** Fires with whether the pad has any prescribable content — meds,
   *  investigations, advice or a follow-up. In Indian OPD practice the
   *  prescription sheet is also where investigations + advice go, so a
   *  meds-free "EEG, MRI, review with reports" pad is still a real Rx. */
  onPadChange?: (hasContent: boolean) => void;
}) {
  const [pad, setPad] = useState<RxPadDraft | null>(null);
  const [padLoaded, setPadLoaded] = useState(false);
  const [diff, setDiff] = useState<DiffState>({ kind: 'loading' });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onPadChangeRef = useRef(onPadChange);
  onPadChangeRef.current = onPadChange;

  const setPadAndNotify = useCallback((next: RxPadDraft | null) => {
    setPad(next);
    onPadChangeRef.current?.(
      (next?.meds ?? []).length > 0 ||
        (next?.investigations ?? []).length > 0 ||
        (next?.adviceLines ?? []).length > 0 ||
        Boolean(next?.followUp?.when),
    );
  }, []);

  // Load the draft pad once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/rx-pad`);
        if (!res.ok) return;
        const parsed = RxPadResponseSchema.safeParse(await res.json());
        if (!cancelled && parsed.success) setPadAndNotify(parsed.data.rxPad);
      } finally {
        if (!cancelled) setPadLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, setPadAndNotify]);

  // Poll the differential until it completes (the differential panel below
  // triggers generation; we only read). Give up quietly after ~2 minutes —
  // the pad remains fully usable without suggestions.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = async (): Promise<void> => {
      tries += 1;
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/differential`);
        if (res.ok) {
          const parsed = DifferentialResponseSchema.safeParse(await res.json());
          if (parsed.success && parsed.data.status === 'COMPLETED' && parsed.data.differential) {
            if (cancelled) return;
            const d = parsed.data.differential;
            const workupFallback = [
              ...new Set(d.candidates.slice(0, 3).flatMap((c) => c.suggestedWorkup)),
            ];
            setDiff({ kind: 'ready', plan: d.suggestedPlan, workupFallback });
            return;
          }
          if (parsed.success && parsed.data.status === 'FAILED') {
            if (!cancelled) setDiff({ kind: 'none' });
            return;
          }
        }
      } catch {
        /* transient — retry */
      }
      if (!cancelled && tries < 24) setTimeout(() => void tick(), 5000);
      else if (!cancelled) setDiff({ kind: 'none' });
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Apply one typed op to the draft pad; the response is the new pad.
  const patch = useCallback(
    async (op: RxPadPatchOp, key: string): Promise<boolean> => {
      setBusyKey(key);
      setError(null);
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/rx-pad`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops: [op] }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'Could not update the plan.');
          return false;
        }
        const parsed = RxPadResponseSchema.safeParse(await res.json());
        if (parsed.success) setPadAndNotify(parsed.data.rxPad);
        return true;
      } catch {
        setError('Could not update the plan — check your connection.');
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [sessionId, setPadAndNotify],
  );

  // Best-effort suggestion-lifecycle audit (feeds the DS9 insights funnel).
  const relay = useCallback(
    (event: 'acted' | 'dismissed', suggestionId: string, label: string) => {
      void fetch(`/api/v1/sessions/${sessionId}/live-suggestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, suggestionId, kind: 'PLAN', label }),
      }).catch(() => {});
    },
    [sessionId],
  );

  function dismiss(id: string, label: string): void {
    setDismissed((prev) => new Set(prev).add(id));
    relay('dismissed', id, label);
  }

  if (!padLoaded) return null;

  const meds = pad?.meds ?? [];
  const investigations = pad?.investigations ?? [];
  const adviceLines = pad?.adviceLines ?? [];
  const padEmpty =
    meds.length === 0 && investigations.length === 0 && adviceLines.length === 0 && !pad?.followUp;

  // Suggestions still open = not already on the pad and not dismissed.
  const has = (list: string[], v: string) =>
    list.some((x) => x.trim().toLowerCase() === v.trim().toLowerCase());
  const plan = diff.kind === 'ready' ? diff.plan : null;
  // Tests: prefer the model's suggestedPlan; fall back to the top
  // candidates' discriminating workup for pre-DS10 differentials.
  const testPool: Array<{ name: string; rationale?: string }> =
    diff.kind === 'ready'
      ? diff.plan.investigations.length > 0
        ? diff.plan.investigations
        : diff.workupFallback.map((name) => ({ name }))
      : [];
  const suggestedTests = testPool.filter(
    (t) =>
      !has(
        investigations.map((i) => i.name),
        t.name,
      ) && !dismissed.has(`plan:test:${t.name}`),
  );
  const suggestedMeds = (plan?.medications ?? []).filter(
    (m) =>
      !has(
        meds.map((x) => x.drug),
        m.drug,
      ) && !dismissed.has(`plan:med:${m.drug}`),
  );
  const suggestedAdvice = (plan?.advice ?? []).filter(
    (a) => !has(adviceLines, a) && !dismissed.has(`plan:advice:${a}`),
  );
  const suggestedFollowUp =
    plan?.followUp && !pad?.followUp && !dismissed.has('plan:fu') ? plan.followUp : null;
  const examSteps = plan?.examSteps ?? [];
  const anySuggestions =
    suggestedTests.length > 0 ||
    suggestedMeds.length > 0 ||
    suggestedAdvice.length > 0 ||
    suggestedFollowUp != null ||
    examSteps.length > 0;

  return (
    <Card className="p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl">Plan &amp; prescription</h2>
        {signed ? (
          <Badge tone="accent">✓ signed — read-only</Badge>
        ) : (
          <Badge tone="muted">becomes the signed Rx</Badge>
        )}
      </div>
      <p className="mb-5 text-xs text-[var(--color-ink-3)]">
        Dictated orders land on your plan automatically. AI suggestions never enter the prescription
        unless you add them — every adoption is recorded.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------- Your plan ------------------------------ */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Your plan
          </h3>

          {padEmpty && (
            <p className="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-6 text-center text-sm text-[var(--color-ink-3)]">
              Nothing on the pad yet — adopt from the AI suggestions or add items below.
            </p>
          )}

          {meds.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Medications
              </p>
              {meds.map((m) => (
                <div
                  key={m.drug}
                  className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{m.drug}</span>
                    <span className="text-xs text-[var(--color-ink-2)]">
                      {[m.strength, m.dose, m.frequency, m.timing].filter(Boolean).join(' · ')}
                      {m.durationDays ? ` · ${m.durationDays} days` : ''}
                    </span>
                    {m.source === 'ai' && <Badge tone="accent">AI · adopted</Badge>}
                    {m.source === 'manual' && <Badge tone="muted">added</Badge>}
                    {m.continued && <Badge tone="muted">continued</Badge>}
                    <span className="ml-auto flex items-center gap-2">
                      {m.status === 'confirmed' ? (
                        <Badge tone="accent">✓ confirmed</Badge>
                      ) : (
                        !signed && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyKey != null}
                            onClick={() =>
                              void patch({ op: 'confirmMed', drug: m.drug }, `confirm:${m.drug}`)
                            }
                          >
                            {busyKey === `confirm:${m.drug}` ? '…' : 'Confirm'}
                          </Button>
                        )
                      )}
                      {!signed && (
                        <RemoveButton
                          busy={busyKey === `rmmed:${m.drug}`}
                          onClick={() =>
                            void patch({ op: 'removeMed', drug: m.drug }, `rmmed:${m.drug}`)
                          }
                        />
                      )}
                    </span>
                  </div>
                  {m.warnings.length > 0 && (
                    <p className="mt-1.5 rounded-lg bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-xs text-[var(--color-warn)]">
                      ⚠ {m.warnings[0]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {investigations.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Investigations
              </p>
              {investigations.map((inv) => (
                <div
                  key={inv.name}
                  className="flex items-baseline gap-2 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2"
                >
                  <span className="text-sm">{inv.name}</span>
                  {inv.rationale && (
                    <span className="text-xs text-[var(--color-ink-3)]">— {inv.rationale}</span>
                  )}
                  {inv.source === 'ai' && <Badge tone="accent">AI</Badge>}
                  {!signed && (
                    <span className="ml-auto">
                      <RemoveButton
                        busy={busyKey === `rminv:${inv.name}`}
                        onClick={() =>
                          void patch(
                            { op: 'removeInvestigation', name: inv.name },
                            `rminv:${inv.name}`,
                          )
                        }
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {adviceLines.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Advice
              </p>
              {adviceLines.map((a) => (
                <div
                  key={a}
                  className="flex items-baseline gap-2 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2"
                >
                  <span className="text-sm">{a}</span>
                  {!signed && (
                    <span className="ml-auto">
                      <RemoveButton
                        busy={busyKey === `rmadv:${a}`}
                        onClick={() => void patch({ op: 'removeAdvice', text: a }, `rmadv:${a}`)}
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {pad?.followUp && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                Follow-up
              </p>
              <div className="mt-1.5 flex items-baseline gap-2 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2">
                <span className="text-sm">
                  {[pad.followUp.when, pad.followUp.withWhat].filter(Boolean).join(' · ')}
                </span>
                {!signed && (
                  <span className="ml-auto">
                    <RemoveButton
                      busy={busyKey === 'rmfu'}
                      onClick={() => void patch({ op: 'clearFollowUp' }, 'rmfu')}
                    />
                  </span>
                )}
              </div>
            </div>
          )}

          {!signed && <ManualAdd busy={busyKey != null} patch={patch} />}
        </section>

        {/* ------------------------------ AI suggests ----------------------------- */}
        <section className="rounded-2xl bg-[var(--color-surface-soft)] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            AI suggests · from the differential
          </h3>

          {diff.kind === 'loading' && (
            <p className="px-1 py-4 text-sm text-[var(--color-ink-3)]">
              Reasoning over the consult…
            </p>
          )}
          {diff.kind === 'none' && (
            <p className="px-1 py-4 text-sm text-[var(--color-ink-3)]">
              No AI suggestions for this consult.
            </p>
          )}
          {diff.kind === 'ready' && !anySuggestions && (
            <p className="px-1 py-4 text-sm text-[var(--color-ink-3)]">
              All suggestions handled — nothing left to review.
            </p>
          )}

          {diff.kind === 'ready' && (
            <div className="space-y-4">
              {examSteps.length > 0 && (
                <SuggestionGroup title="Consider examining">
                  {examSteps.map((s) => (
                    <li key={s} className="px-3.5 py-2 text-sm text-[var(--color-ink-2)]">
                      {s}
                    </li>
                  ))}
                </SuggestionGroup>
              )}

              {suggestedTests.length > 0 && (
                <SuggestionGroup title="Tests to consider">
                  {suggestedTests.map((t) => (
                    <SuggestionRow
                      key={t.name}
                      label={t.name}
                      rationale={t.rationale}
                      disabled={signed || busyKey != null}
                      busy={busyKey === `adopt:test:${t.name}`}
                      onAdd={async () => {
                        const ok = await patch(
                          {
                            op: 'addInvestigation',
                            source: 'ai',
                            name: t.name,
                            ...(t.rationale ? { rationale: t.rationale } : {}),
                          },
                          `adopt:test:${t.name}`,
                        );
                        if (ok) relay('acted', `plan:test:${t.name}`, t.name);
                      }}
                      onDismiss={() => dismiss(`plan:test:${t.name}`, t.name)}
                    />
                  ))}
                </SuggestionGroup>
              )}

              {suggestedMeds.length > 0 && (
                <SuggestionGroup title="Medicines to consider">
                  {suggestedMeds.map((m) => (
                    <SuggestionRow
                      key={m.drug}
                      label={[m.drug, m.strength].filter(Boolean).join(' ')}
                      detail={[m.frequency, m.timing, m.durationDays && `${m.durationDays} days`]
                        .filter(Boolean)
                        .join(' · ')}
                      rationale={m.rationale}
                      disabled={signed || busyKey != null}
                      busy={busyKey === `adopt:med:${m.drug}`}
                      onAdd={async () => {
                        const ok = await patch(
                          {
                            op: 'addMed',
                            source: 'ai',
                            med: {
                              drug: m.drug,
                              ...(m.strength ? { strength: m.strength } : {}),
                              ...(m.dose ? { dose: m.dose } : {}),
                              ...(m.frequency ? { frequency: m.frequency } : {}),
                              ...(m.timing ? { timing: m.timing } : {}),
                              ...(m.durationDays ? { durationDays: m.durationDays } : {}),
                            },
                          },
                          `adopt:med:${m.drug}`,
                        );
                        if (ok) relay('acted', `plan:med:${m.drug}`, m.drug);
                      }}
                      onDismiss={() => dismiss(`plan:med:${m.drug}`, m.drug)}
                    />
                  ))}
                </SuggestionGroup>
              )}

              {suggestedAdvice.length > 0 && (
                <SuggestionGroup title="Advice to consider">
                  {suggestedAdvice.map((a) => (
                    <SuggestionRow
                      key={a}
                      label={a}
                      disabled={signed || busyKey != null}
                      busy={busyKey === `adopt:adv:${a}`}
                      onAdd={async () => {
                        const ok = await patch(
                          { op: 'addAdvice', source: 'ai', text: a },
                          `adopt:adv:${a}`,
                        );
                        if (ok) relay('acted', `plan:advice:${a}`, a);
                      }}
                      onDismiss={() => dismiss(`plan:advice:${a}`, a)}
                    />
                  ))}
                </SuggestionGroup>
              )}

              {suggestedFollowUp && (
                <SuggestionGroup title="Follow-up">
                  <SuggestionRow
                    label={[suggestedFollowUp.when, suggestedFollowUp.withWhat]
                      .filter(Boolean)
                      .join(' · ')}
                    disabled={signed || busyKey != null}
                    busy={busyKey === 'adopt:fu'}
                    onAdd={async () => {
                      const ok = await patch(
                        {
                          op: 'setFollowUp',
                          source: 'ai',
                          when: suggestedFollowUp.when,
                          ...(suggestedFollowUp.withWhat
                            ? { withWhat: suggestedFollowUp.withWhat }
                            : {}),
                        },
                        'adopt:fu',
                      );
                      if (ok) relay('acted', 'plan:fu', suggestedFollowUp.when);
                    }}
                    onDismiss={() => dismiss('plan:fu', suggestedFollowUp.when)}
                  />
                </SuggestionGroup>
              )}
            </div>
          )}

          <p className="mt-4 text-[11px] italic text-[var(--color-ink-3)]">
            Decision-support only. Nothing enters the prescription unless you add it.
          </p>
        </section>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function SuggestionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        {title}
      </p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function SuggestionRow({
  label,
  detail,
  rationale,
  disabled,
  busy,
  onAdd,
  onDismiss,
}: {
  label: string;
  detail?: string;
  rationale?: string | undefined;
  disabled: boolean;
  busy: boolean;
  onAdd: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <li className="rounded-xl border border-[var(--color-line-soft)] bg-white px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-ink)]">
            {label}
            {detail && (
              <span className="ml-1.5 font-normal text-[var(--color-ink-2)]">{detail}</span>
            )}
          </p>
          {rationale && <p className="text-xs text-[var(--color-ink-3)]">{rationale}</p>}
        </div>
        <Button size="sm" disabled={disabled} onClick={() => void onAdd()}>
          {busy ? '…' : '+ Add'}
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={disabled}
          aria-label={`Dismiss ${label}`}
          className="rounded-full px-2 py-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function RemoveButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      className="rounded-full px-1.5 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
    >
      {busy ? '…' : '✕'}
    </button>
  );
}

/** Inline manual-add: medicine / test / advice / follow-up. */
function ManualAdd({
  busy,
  patch,
}: {
  busy: boolean;
  patch: (op: RxPadPatchOp, key: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<'med' | 'test' | 'advice' | 'fu' | null>(null);
  const [drug, setDrug] = useState('');
  const [strength, setStrength] = useState('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [testName, setTestName] = useState('');
  const [advice, setAdvice] = useState('');
  const [fuWhen, setFuWhen] = useState('');

  function reset(): void {
    setOpen(null);
    setDrug('');
    setStrength('');
    setFrequency('');
    setDurationDays('');
    setTestName('');
    setAdvice('');
    setFuWhen('');
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    let ok = false;
    if (open === 'med' && drug.trim()) {
      const days = Number.parseInt(durationDays, 10);
      ok = await patch(
        {
          op: 'addMed',
          source: 'manual',
          med: {
            drug: drug.trim(),
            ...(strength.trim() ? { strength: strength.trim() } : {}),
            ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
            ...(Number.isFinite(days) && days > 0 ? { durationDays: days } : {}),
          },
        },
        'manual:med',
      );
    } else if (open === 'test' && testName.trim()) {
      ok = await patch(
        { op: 'addInvestigation', source: 'manual', name: testName.trim() },
        'manual:test',
      );
    } else if (open === 'advice' && advice.trim()) {
      ok = await patch({ op: 'addAdvice', source: 'manual', text: advice.trim() }, 'manual:adv');
    } else if (open === 'fu' && fuWhen.trim()) {
      ok = await patch({ op: 'setFollowUp', source: 'manual', when: fuWhen.trim() }, 'manual:fu');
    }
    if (ok) reset();
  }

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen('med')}>
          + Medicine
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen('test')}>
          + Test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen('advice')}>
          + Advice
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen('fu')}>
          + Follow-up
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 space-y-3 rounded-xl border border-[var(--color-line)] bg-white p-3.5"
    >
      {open === 'med' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pc-drug">Medicine</Label>
            <Input
              id="pc-drug"
              value={drug}
              onChange={(e) => setDrug(e.target.value)}
              placeholder="Paracetamol"
              required
            />
          </div>
          <div>
            <Label htmlFor="pc-strength" hint="optional">
              Strength
            </Label>
            <Input
              id="pc-strength"
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              placeholder="650 mg"
            />
          </div>
          <div>
            <Label htmlFor="pc-freq" hint="optional · 1-0-1 = morning-noon-night">
              Frequency
            </Label>
            <Input
              id="pc-freq"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder="1-0-1"
            />
          </div>
          <div>
            <Label htmlFor="pc-days" hint="optional">
              Days
            </Label>
            <Input
              id="pc-days"
              inputMode="numeric"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value.replace(/\D/g, ''))}
              placeholder="5"
            />
          </div>
        </div>
      )}
      {open === 'test' && (
        <div>
          <Label htmlFor="pc-test">Test / investigation</Label>
          <Input
            id="pc-test"
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            placeholder="CBC"
            required
          />
        </div>
      )}
      {open === 'advice' && (
        <div>
          <Label htmlFor="pc-advice">Advice</Label>
          <Input
            id="pc-advice"
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder="Plenty of fluids; rest for 2 days"
            required
          />
        </div>
      )}
      {open === 'fu' && (
        <div>
          <Label htmlFor="pc-fu">Follow-up</Label>
          <Input
            id="pc-fu"
            value={fuWhen}
            onChange={(e) => setFuWhen(e.target.value)}
            placeholder="In 3 days, with reports"
            required
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={reset}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy}>
          Add
        </Button>
      </div>
    </form>
  );
}
