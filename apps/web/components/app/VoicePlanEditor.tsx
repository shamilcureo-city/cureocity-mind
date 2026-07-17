'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PlanDictationProposalSchema,
  type PlanDictationProposal,
  type RxFollowUp,
  type RxInvestigation,
  type RxMedRow,
  type RxPadDraft,
  type RxPadPatchOp,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { useLiveStream } from '@/lib/audio/use-live-stream';

/**
 * Sprint DS12 — voice-edit the plan.
 *
 * One tap → speak the change ("change amlodipine to 10, add atorvastatin 20
 * at night, drop the ECG") → the dictation pass proposes typed pad edits →
 * the doctor reviews the diff (per-line exclude, new-interaction chips) →
 * Apply goes through the SAME audited PATCH /rx-pad path as every other pad
 * edit, with a one-tap Undo built from inverse ops. Nothing applies without
 * the review tap; a removed PENDING med is restored as pending (unconfirmMed)
 * so Undo can never silently prescribe.
 */

const MAX_CLIP_MS = 60_000;
/** Anything under ~0.4 s of 16 kHz s16le audio can't hold an instruction. */
const MIN_CLIP_BYTES = 12_800;

type Phase = 'idle' | 'listening' | 'thinking' | 'proposal';

export function VoicePlanEditor({
  sessionId,
  pad,
  disabled,
  onApply,
}: {
  sessionId: string;
  /** The composer's current pad — the base the Undo inverse is computed from. */
  pad: RxPadDraft | null;
  disabled: boolean;
  /** Applies ops through the composer's PATCH path (chunked, audited). */
  onApply: (ops: RxPadPatchOp[], key: string) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<PlanDictationProposal | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [typing, setTyping] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ count: number; undoOps: RxPadPatchOp[] } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const framesRef = useRef<Uint8Array[]>([]);
  const startedAtRef = useRef(0);
  const stream = useLiveStream({
    onFrame: (pcm) => framesRef.current.push(pcm),
  });
  const streamStopRef = useRef(stream.stop);
  streamStopRef.current = stream.stop;

  // Listening clock + the 60s auto-stop.
  useEffect(() => {
    if (phase !== 'listening') return;
    const id = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_CLIP_MS) void finishListening();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Never leave the mic open on unmount.
  useEffect(() => {
    return () => {
      void streamStopRef.current();
    };
  }, []);

  async function startListening(): Promise<void> {
    setError(null);
    setApplied(null);
    framesRef.current = [];
    setElapsedMs(0);
    try {
      await stream.start();
      startedAtRef.current = Date.now();
      setPhase('listening');
    } catch {
      setError('Could not open the microphone.');
    }
  }

  async function cancelListening(): Promise<void> {
    await stream.stop();
    framesRef.current = [];
    setPhase('idle');
  }

  async function finishListening(): Promise<void> {
    setPhase('thinking');
    await stream.stop();
    const frames = framesRef.current;
    framesRef.current = [];
    const total = frames.reduce((n, f) => n + f.length, 0);
    if (total < MIN_CLIP_BYTES) {
      setPhase('idle');
      setError('That was too short — tap the mic and speak the change.');
      return;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const f of frames) {
      bytes.set(f, offset);
      offset += f.length;
    }
    await requestProposal({
      audioBase64: toBase64(bytes),
      durationMs: Math.max(1, Math.round(bytes.length / 32)),
    });
  }

  async function submitText(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = textDraft.trim();
    if (!text) return;
    setError(null);
    setApplied(null);
    setPhase('thinking');
    await requestProposal({ text });
  }

  async function requestProposal(body: Record<string, unknown>): Promise<void> {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/plan-dictation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Could not interpret that (${res.status}).`);
      }
      const parsed = PlanDictationProposalSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error('Unexpected response — please try again.');
      setProposal(parsed.data);
      setExcluded(new Set());
      setTextDraft('');
      setTyping(false);
      setPhase('proposal');
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  function discardProposal(): void {
    setProposal(null);
    setPhase('idle');
  }

  async function applyProposal(): Promise<void> {
    if (!proposal) return;
    const included = proposal.changes.filter((_, i) => !excluded.has(i));
    const ops = included.flatMap((c) => c.ops);
    if (ops.length === 0) {
      discardProposal();
      return;
    }
    setApplying(true);
    setError(null);
    // The inverse is computed against the pad as it reads RIGHT NOW —
    // undo restores this exact state.
    const undoOps = invertOps(pad, ops);
    const ok = await onApply(ops, 'voice:apply');
    setApplying(false);
    if (!ok) {
      setError('Could not apply the changes — the plan shows the details.');
      return;
    }
    setProposal(null);
    setPhase('idle');
    setApplied({ count: included.length, undoOps });
  }

  async function undo(): Promise<void> {
    if (!applied) return;
    setUndoing(true);
    const ok = await onApply(applied.undoOps, 'voice:undo');
    setUndoing(false);
    if (ok) setApplied(null);
  }

  const listening = phase === 'listening';
  const thinking = phase === 'thinking';

  return (
    <div className="mb-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
      {phase !== 'proposal' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-label={listening ? 'Finish speaking' : 'Change the plan by voice'}
            disabled={disabled || thinking}
            onClick={() => void (listening ? finishListening() : startListening())}
            className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-full text-white transition-colors disabled:opacity-50 ${
              listening ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-accent)] hover:opacity-90'
            }`}
          >
            {listening && (
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full bg-[var(--color-warn)] opacity-40 motion-reduce:hidden"
              />
            )}
            <span className="relative text-lg">{listening ? '■' : '🎙'}</span>
          </button>
          <div className="min-w-0 flex-1">
            {listening ? (
              <>
                <p className="text-sm font-medium">
                  Listening…{' '}
                  <span className="font-mono tabular-nums">{formatClock(elapsedMs)}</span>
                </p>
                <p className="text-xs text-[var(--color-ink-3)]">
                  Say the changes, then tap ■ to finish.
                </p>
              </>
            ) : thinking ? (
              <p className="text-sm font-medium">Interpreting the instruction…</p>
            ) : (
              <>
                <p className="text-sm font-medium">Change the plan by voice</p>
                <p className="text-xs text-[var(--color-ink-3)]">
                  “Change amlodipine to 10, add atorvastatin 20 at night, drop the ECG.” You review
                  every change before it applies.
                </p>
              </>
            )}
          </div>
          {listening ? (
            <Button size="sm" variant="ghost" onClick={() => void cancelListening()}>
              Cancel
            </Button>
          ) : (
            !thinking && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setTyping((t) => !t)}
              >
                Type instead
              </Button>
            )
          )}
        </div>
      )}

      {typing && phase === 'idle' && (
        <form onSubmit={(e) => void submitText(e)} className="mt-3 flex gap-2">
          <Input
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="change amlodipine to 10, order lipid profile…"
            aria-label="Type the plan change"
          />
          <Button size="sm" type="submit" disabled={disabled || !textDraft.trim()}>
            Propose
          </Button>
        </form>
      )}

      {phase === 'proposal' && proposal && (
        <div>
          <p className="text-xs text-[var(--color-ink-3)]">
            Heard: <span className="italic">“{proposal.transcript.trim()}”</span>
          </p>
          {proposal.changes.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {proposal.changes.map((change, i) => {
                const isExcluded = excluded.has(i);
                return (
                  <li
                    key={`${change.label}-${i}`}
                    className={`rounded-xl border bg-white px-3.5 py-2.5 ${
                      isExcluded
                        ? 'border-[var(--color-line-soft)] opacity-50'
                        : 'border-[var(--color-line)]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className={`mt-0.5 font-mono text-sm font-bold ${
                          change.kind === 'add'
                            ? 'text-[var(--color-accent)]'
                            : change.kind === 'remove'
                              ? 'text-[var(--color-warn)]'
                              : 'text-[var(--color-ink-2)]'
                        }`}
                      >
                        {change.kind === 'add' ? '+' : change.kind === 'remove' ? '−' : '~'}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        {change.kind === 'change' && change.before ? (
                          <p>
                            <span className="text-[var(--color-ink-3)] line-through">
                              {change.before}
                            </span>{' '}
                            <span aria-hidden>→</span>{' '}
                            <span className="font-medium">{change.after ?? change.label}</span>
                          </p>
                        ) : (
                          <p className={change.kind === 'remove' ? '' : 'font-medium'}>
                            {change.label}
                            <span className="ml-1.5 text-xs text-[var(--color-ink-3)]">
                              {targetLabel(change.target)}
                            </span>
                          </p>
                        )}
                        {change.warnings.map((w) => (
                          <p
                            key={w}
                            className="mt-1 rounded-lg bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-xs text-[var(--color-warn)]"
                          >
                            💊 {w}
                          </p>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className="rounded-full px-2 py-0.5 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                      >
                        {isExcluded ? 'Include' : '✕ Skip'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {proposal.clarifications.length > 0 && (
            <ul className="mt-3 space-y-1">
              {proposal.clarifications.map((c) => (
                <li key={c} className="text-sm text-[var(--color-warn)]">
                  ? {c}
                </li>
              ))}
            </ul>
          )}
          {proposal.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {proposal.skipped.map((s) => (
                <li key={s} className="text-xs text-[var(--color-ink-3)]">
                  {s}
                </li>
              ))}
            </ul>
          )}
          {proposal.changes.length === 0 && proposal.clarifications.length === 0 && (
            <p className="mt-3 text-sm text-[var(--color-ink-2)]">
              Nothing to change from that — the pad stays as it is.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {proposal.changes.length > 0 && (
              <Button
                size="sm"
                disabled={applying || disabled || excluded.size >= proposal.changes.length}
                onClick={() => void applyProposal()}
              >
                {applying
                  ? 'Applying…'
                  : `Apply ${proposal.changes.length - excluded.size} change${
                      proposal.changes.length - excluded.size === 1 ? '' : 's'
                    }`}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={applying} onClick={discardProposal}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {applied && phase === 'idle' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--color-accent)]">
            ✓ Applied {applied.count} change{applied.count === 1 ? '' : 's'}.
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={undoing || disabled}
            onClick={() => void undo()}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </Button>
        </div>
      )}

      {(error ?? stream.error) && (
        <p className="mt-2 text-sm text-[var(--color-warn)]">{error ?? stream.error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function targetLabel(target: 'med' | 'investigation' | 'advice' | 'followUp'): string {
  switch (target) {
    case 'med':
      return 'medicine';
    case 'investigation':
      return 'test';
    case 'advice':
      return 'advice';
    case 'followUp':
      return 'follow-up';
  }
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const key = (s: string): string => s.trim().toLowerCase();

/**
 * Build the ops that restore `prePad` after `ops` are applied. Each op's
 * inverse is computed against the simulated state right before it, and the
 * inverse GROUPS are replayed in reverse order (a group keeps its own order —
 * re-adding a pending med is addMed THEN unconfirmMed).
 */
export function invertOps(prePad: RxPadDraft | null, ops: RxPadPatchOp[]): RxPadPatchOp[] {
  const meds = new Map<string, RxMedRow>();
  for (const m of prePad?.meds ?? []) meds.set(key(m.drug), m);
  const investigations = new Map<string, RxInvestigation>();
  for (const inv of prePad?.investigations ?? []) investigations.set(key(inv.name), inv);
  const advice = new Map<string, string>();
  for (const a of prePad?.adviceLines ?? []) advice.set(key(a), a);
  let followUp: RxFollowUp | undefined = prePad?.followUp;

  const groups: RxPadPatchOp[][] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'addMed': {
        if (!meds.has(key(op.med.drug))) {
          groups.push([{ op: 'removeMed', drug: op.med.drug }]);
          meds.set(key(op.med.drug), {
            ...op.med,
            continued: false,
            status: 'confirmed',
            warnings: [],
            source: op.source,
          });
        }
        break; // duplicate add is a server-side no-op — nothing to invert
      }
      case 'removeMed': {
        const row = meds.get(key(op.drug));
        if (row) {
          const restore: RxPadPatchOp[] = [
            {
              op: 'addMed',
              source: row.source ?? 'manual',
              med: {
                drug: row.drug,
                ...(row.strength !== undefined && { strength: row.strength }),
                ...(row.dose !== undefined && { dose: row.dose }),
                ...(row.frequency !== undefined && { frequency: row.frequency }),
                ...(row.timing !== undefined && { timing: row.timing }),
                ...(row.durationDays !== undefined && { durationDays: row.durationDays }),
                ...(row.route !== undefined && { route: row.route }),
              },
            },
          ];
          // A pending row must come back pending — never silently prescribed.
          if (row.status === 'pending') restore.push({ op: 'unconfirmMed', drug: row.drug });
          groups.push(restore);
          meds.delete(key(op.drug));
        }
        break;
      }
      case 'confirmMed': {
        const row = meds.get(key(op.drug));
        if (row && row.status === 'pending') {
          groups.push([{ op: 'unconfirmMed', drug: row.drug }]);
          meds.set(key(op.drug), { ...row, status: 'confirmed' });
        }
        break;
      }
      case 'unconfirmMed': {
        const row = meds.get(key(op.drug));
        if (row && row.status === 'confirmed') {
          groups.push([{ op: 'confirmMed', drug: row.drug }]);
          meds.set(key(op.drug), { ...row, status: 'pending' });
        }
        break;
      }
      case 'addInvestigation': {
        if (!investigations.has(key(op.name))) {
          groups.push([{ op: 'removeInvestigation', name: op.name }]);
          investigations.set(key(op.name), {
            name: op.name,
            ...(op.rationale !== undefined && { rationale: op.rationale }),
            source: op.source,
          });
        }
        break;
      }
      case 'removeInvestigation': {
        const row = investigations.get(key(op.name));
        if (row) {
          groups.push([
            {
              op: 'addInvestigation',
              source: row.source ?? 'manual',
              name: row.name,
              ...(row.rationale !== undefined && { rationale: row.rationale }),
            },
          ]);
          investigations.delete(key(op.name));
        }
        break;
      }
      case 'addAdvice': {
        if (!advice.has(key(op.text))) {
          groups.push([{ op: 'removeAdvice', text: op.text }]);
          advice.set(key(op.text), op.text);
        }
        break;
      }
      case 'removeAdvice': {
        const line = advice.get(key(op.text));
        if (line !== undefined) {
          groups.push([{ op: 'addAdvice', source: 'manual', text: line }]);
          advice.delete(key(op.text));
        }
        break;
      }
      case 'setFollowUp': {
        groups.push([
          followUp
            ? {
                op: 'setFollowUp',
                source: 'manual',
                when: followUp.when,
                ...(followUp.withWhat !== undefined && { withWhat: followUp.withWhat }),
              }
            : { op: 'clearFollowUp' },
        ]);
        followUp = { when: op.when, ...(op.withWhat !== undefined && { withWhat: op.withWhat }) };
        break;
      }
      case 'clearFollowUp': {
        if (followUp) {
          groups.push([
            {
              op: 'setFollowUp',
              source: 'manual',
              when: followUp.when,
              ...(followUp.withWhat !== undefined && { withWhat: followUp.withWhat }),
            },
          ]);
          followUp = undefined;
        }
        break;
      }
    }
  }
  return groups.reverse().flat();
}
