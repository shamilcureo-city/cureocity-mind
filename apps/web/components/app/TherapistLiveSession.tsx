'use client';

/**
 * Sprint TS2 → TS-B2..B5 — the therapist live scribe surface.
 *
 * The therapist analogue of DoctorLiveEncounter, redesigned to read like the
 * session itself (see docs/THERAPIST_SCRIBE_SPRINTS.md + the approved mock):
 *   - a speaker-true CONVERSATION (one bubble per diarized segment — B1 made
 *     the gateway emit per-segment utterances) with timestamps, auto-scroll
 *     and a live talk-balance bar;
 *   - a LIVE NOTE that visibly assembles — every section always on screen,
 *     unfilled ones as placeholders, "Updated Xs ago" + an Update-now button
 *     (the `refreshNote` gateway command) instead of a silent 90s wait;
 *   - a RISK WATCH that is always present (calm state → escalates in place);
 *   - on INTAKE sessions, a WHAT-TO-EXPLORE coverage checklist derived from
 *     which intake-note fields are still "(not elicited)" — zero extra AI cost;
 *   - header chips that tell the truth: "Note: English" vs "Hearing: ML·EN".
 *
 * On end it relays the finalized note to the live-note route (persisted as a
 * COMPLETED NoteDraft) and routes to the session workspace for review + sign.
 *
 * NOTE: like DoctorLiveEncounter, this is a browser-only WS/audio surface — it
 * cannot be exercised in CI. Drive it once with `pnpm gateway` before trusting.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LiveGatewayEventSchema,
  type IntakeNoteV1,
  type MeterSummary,
  type SessionKind,
  type SessionModality,
  type TherapyCarriedQuestion,
  type TherapyReasoningV1,
  type TherapyNoteV1,
  type Utterance,
} from '@cureocity/contracts';
import { useLiveStream } from '@/lib/audio/use-live-stream';
import { useWakeLock } from '@/lib/audio/use-wake-lock';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TherapyCopilotRail } from './TherapyCopilotRail';

const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

interface Props {
  sessionId: string;
  /** AUD2 — for the batch-fallback deep link when the gateway drops. */
  clientId?: string | null;
  kind: SessionKind;
  modality: SessionModality | null;
  /** Session.language — the language the NOTE is written in. */
  language: string;
  clientName?: string;
  /** Auto-start the mic once (arriving via a flash/queue flow). */
  autoStart?: boolean;
  /** Sprint TS5 — the copilot's live context (fed to the gateway at connect). */
  carriedQuestions?: TherapyCarriedQuestion[];
  priorRisk?: boolean;
  plannedMinutes?: number | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  bn: 'Bengali',
};

/** Indic-script detection for the "Hearing: ML·EN" chip — no model call. */
const SCRIPT_CODES: [RegExp, string][] = [
  [/[ഀ-ൿ]/, 'ML'],
  [/[ऀ-ॿ]/, 'HI'],
  [/[஀-௿]/, 'TA'],
  [/[ঀ-৿]/, 'BN'],
  [/[ఀ-౿]/, 'TE'],
  [/[ಀ-೿]/, 'KN'],
  [/[઀-૿]/, 'GU'],
];

function hearingCodes(utterances: Utterance[]): string[] {
  const seen = new Set<string>();
  let latin = false;
  for (const u of utterances) {
    for (const [re, code] of SCRIPT_CODES) if (re.test(u.text)) seen.add(code);
    if (/[A-Za-z]/.test(u.text)) latin = true;
  }
  const out = [...seen];
  if (latin) out.push('EN');
  return out.slice(0, 3);
}

/** The note sections we render, in order, per kind — empty values included so
 *  the panel shows placeholders for what hasn't been written yet. */
function noteSections(
  kind: SessionKind,
  note: Record<string, unknown>,
): { label: string; value: string }[] {
  const rows: [string, string][] =
    kind === 'INTAKE'
      ? [
          ['Presenting concerns', 'presentingConcerns'],
          ['History of present illness', 'historyOfPresentingIllness'],
          ['Mental status exam', 'mentalStatusExam'],
          ['Working hypothesis', 'workingHypothesis'],
          ['Immediate plan', 'immediatePlan'],
        ]
      : [
          ['Summary', 'summary'],
          ['Subjective', 'subjective'],
          ['Objective', 'objective'],
          ['Assessment', 'assessment'],
          ['Plan', 'plan'],
        ];
  return rows.map(([label, key]) => ({
    label,
    value: typeof note[key] === 'string' ? (note[key] as string) : '',
  }));
}

function readRisk(note: Record<string, unknown>): { severity: string; text: string } | null {
  const rf = note['riskFlags'];
  if (!rf || typeof rf !== 'object') return null;
  const r = rf as { severity?: string; indicators?: unknown; details?: string };
  if (!r.severity || r.severity === 'none') return null;
  const indicators = Array.isArray(r.indicators)
    ? r.indicators.filter((x) => typeof x === 'string')
    : [];
  return {
    severity: r.severity,
    text: r.details?.trim() || indicators.join('; ') || 'Elevated risk — assess safety.',
  };
}

/** TS-B5 — the intake coverage checklist, read straight off the live note. */
const INTAKE_COVERAGE: [string, string][] = [
  ['presentingConcerns', 'Presenting concerns'],
  ['historyOfPresentingIllness', 'History'],
  ['pastPsychiatricHistory', 'Past psychiatric'],
  ['familyHistory', 'Family history'],
  ['socialHistory', 'Social history'],
  ['mentalStatusExam', 'Mental status'],
  ['workingHypothesis', 'Hypothesis'],
  ['immediatePlan', 'Plan'],
];

function intakeCoverage(note: Record<string, unknown>): { label: string; done: boolean }[] {
  return INTAKE_COVERAGE.map(([key, label]) => {
    const v = note[key];
    const done =
      typeof v === 'string' && v.trim().length > 0 && !/not elicited|none elicited/i.test(v);
    return { label, done };
  });
}

function noteTopics(note: Record<string, unknown>): string[] {
  const t = note['topics'];
  if (!Array.isArray(t)) return [];
  return t
    .map((x) =>
      x && typeof x === 'object' && typeof (x as { title?: unknown }).title === 'string'
        ? ((x as { title: string }).title as string)
        : null,
    )
    .filter((x): x is string => Boolean(x))
    .slice(0, 6);
}

/** Speaking-time split between attributed speakers; null until ≥10s heard. */
function talkBalance(utterances: Utterance[]): { you: number; client: number } | null {
  let you = 0;
  let client = 0;
  for (const u of utterances) {
    const d = Math.max(0, u.tEndMs - u.tStartMs);
    if (u.speaker === 'doctor') you += d;
    else if (u.speaker === 'patient') client += d;
  }
  const total = you + client;
  if (total < 10_000) return null;
  const youPct = Math.round((you / total) * 100);
  return { you: youPct, client: 100 - youPct };
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

export function TherapistLiveSession({
  sessionId,
  clientId = null,
  kind,
  modality,
  language,
  clientName,
  autoStart,
  carriedQuestions = [],
  priorRisk = false,
  plannedMinutes = null,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [note, setNote] = useState<Record<string, unknown>>({});
  const [noteUpdatedAt, setNoteUpdatedAt] = useState<number | null>(null);
  const [refreshingNote, setRefreshingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  // Sprint TS5 — the live copilot snapshot (risk / ask-next / threads / arc).
  const [copilot, setCopilot] = useState<TherapyReasoningV1 | null>(null);
  // TS5.4 — ids the therapist resolved (asked/assessed/dismissed). Applied
  // optimistically to whatever snapshot renders, so a card leaves the rail on
  // tap instead of waiting for the gateway's next emission.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  // Ref mirror so ws.onopen (a closure) can replay pre-connection resolutions.
  const resolvedRef = useRef<Set<string>>(new Set());
  // Set when the consult ended but no note ever arrived (Pass 2 empty/blocked
  // upstream). Terminal, recoverable — never leave the user on "Finishing…".
  const [noteFailed, setNoteFailed] = useState(false);
  // AUD2 — the gateway socket closed mid-session without a final note:
  // surface a recovery card instead of hanging on "listening" forever.
  const [connectionLost, setConnectionLost] = useState(false);

  // AUD2 — keep the phone screen awake while listening. The batch recorder
  // always did this; the live scribe losing the screen ~30s in put the mic
  // and the socket at the OS's mercy on the exact device the pilot targets.
  useWakeLock(phase === 'listening' || phase === 'finalizing');

  // TS5.4 — the SESSION PLAN, rendered before the gateway says a word. Seeds
  // the rail with the carried/copilot questions and the deterministic prior-SI
  // re-check, using the SAME ids the gateway's store assigns (`carried-<i>`,
  // 'risk-recheck'), so a dismissal here also lands on the gateway item once
  // connected. The first real gateway snapshot simply replaces this.
  const seedReasoning = useMemo<TherapyReasoningV1 | null>(() => {
    if (carriedQuestions.length === 0 && !priorRisk) return null;
    return {
      riskWatch: priorRisk
        ? [
            {
              id: 'risk-recheck',
              label: 'Re-check ideation',
              why: 'Prior suicidal ideation is on file — re-assess ideation, intent and means today.',
              severity: 'high' as const,
              source: 'CARRIED_RISK' as const,
              sourceUtteranceIds: [],
            },
          ]
        : [],
      askNext: carriedQuestions.map((q, i) => ({
        id: `carried-${i}`,
        question: q.question,
        why: q.why ?? 'You planned to ask this at the start of the session.',
        source: 'CARRIED' as const,
        priority: 'normal' as const,
        status: 'open' as const,
        sourceUtteranceIds: [],
      })),
      threads: [],
      arc: null,
      version: 0,
    };
  }, [carriedQuestions, priorRisk]);

  // What the rail renders: the latest gateway snapshot, or the local seed
  // until one arrives — minus everything the therapist already resolved.
  const effectiveCopilot = useMemo<TherapyReasoningV1 | null>(() => {
    const base = copilot ?? seedReasoning;
    if (!base) return null;
    if (resolvedIds.size === 0) return base;
    return {
      ...base,
      riskWatch: base.riskWatch.filter((r) => !resolvedIds.has(r.id)),
      askNext: base.askNext.filter((a) => !resolvedIds.has(a.id)),
      threads: base.threads.filter((t) => !resolvedIds.has(t.id)),
    };
  }, [copilot, seedReasoning, resolvedIds]);

  const wsRef = useRef<WebSocket | null>(null);
  const meterRef = useRef<MeterSummary | null>(null);
  const meteredRef = useRef(false);
  const finalHandledRef = useRef(false);
  const convoRef = useRef<HTMLDivElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stream = useLiveStream({
    onFrame: (pcm) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) ws.send(pcm);
    },
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;
  // AUD2 — ws.onclose is a long-lived closure; it reads the CURRENT phase
  // through this ref rather than a stale capture.
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      void streamRef.current.stop();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Elapsed timer while listening — also drives the "Updated Xs ago" ticker.
  useEffect(() => {
    if (phase !== 'listening') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Auto-scroll the conversation when new turns arrive, unless the therapist
  // has scrolled up to re-read (stay out of their way).
  useEffect(() => {
    const el = convoRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [utterances.length]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !autoStartedRef.current && phase === 'idle') {
      autoStartedRef.current = true;
      void start();
    }
  }, [autoStart, phase]);

  // Sprint TS5 — record a "shown" audit the first time each copilot card
  // appears, so the pilot dataset captures shown → acted/dismissed. The
  // deterministic SI re-check is excluded (it's not a model suggestion).
  const shownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!copilot) return;
    const items: { id: string; kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP'; label: string }[] = [
      ...copilot.riskWatch
        .filter((r) => r.source !== 'CARRIED_RISK')
        .map((r) => ({ id: r.id, kind: 'RED_FLAG' as const, label: r.label })),
      ...copilot.askNext
        .filter((a) => a.source === 'LIVE')
        .map((a) => ({ id: a.id, kind: 'ASK_NEXT' as const, label: a.question })),
      ...copilot.threads.map((t) => ({ id: t.id, kind: 'GAP' as const, label: t.topic })),
    ];
    for (const it of items) {
      if (shownIdsRef.current.has(it.id)) continue;
      shownIdsRef.current.add(it.id);
      relaySuggestion('shown', it.id, it.kind, it.label);
    }
  }, [copilot]);

  function buildTranscript(items: Utterance[]): string {
    return [...items]
      .sort((a, b) => a.tStartMs - b.tStartMs)
      .map((u) => {
        const text = u.text.trim();
        if (!text) return '';
        const who =
          u.speaker === 'doctor' ? 'Therapist' : u.speaker === 'patient' ? 'Client' : 'Speaker';
        return `${who}: ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  async function persistMeter(summary: MeterSummary): Promise<void> {
    if (meteredRef.current) return;
    meteredRef.current = true;
    try {
      await fetch(`/api/v1/sessions/${sessionId}/live-metric`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
      });
    } catch {
      /* telemetry is best-effort */
    }
  }

  async function persistAndFinish(
    finalKind: SessionKind,
    finalNote: TherapyNoteV1 | IntakeNoteV1,
    transcript: string,
  ): Promise<void> {
    if (finalHandledRef.current) return;
    finalHandledRef.current = true;
    setSaving(true);
    try {
      await fetch(`/api/v1/sessions/${sessionId}/live-note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: finalKind,
          note: finalNote,
          ...(transcript ? { transcript } : {}),
        }),
      });
      if (meterRef.current) void persistMeter(meterRef.current);
      // The note is a COMPLETED NoteDraft now — the workspace shows it ready to
      // review + sign, with no generation wait.
      router.push(`/app/sessions/${sessionId}`);
      router.refresh();
    } catch (e) {
      setError(`Couldn't save the note: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  async function start(): Promise<void> {
    setError(null);
    setNoteFailed(false);
    setConnectionLost(false);
    setUtterances([]);
    setNote({});
    setNoteUpdatedAt(null);
    setRefreshingNote(false);
    setElapsed(0);
    meteredRef.current = false;
    meterRef.current = null;
    finalHandledRef.current = false;
    setPhase('connecting');

    if (window.location.protocol === 'https:' && GATEWAY_URL.startsWith('ws://')) {
      setPhase('error');
      setError(
        'The live scribe is not configured for secure connections. Record the batch way instead.',
      );
      return;
    }

    let token: string | undefined;
    try {
      const r = await fetch(`/api/v1/sessions/${sessionId}/live-token`, { method: 'POST' });
      if (r.ok) token = ((await r.json()) as { token?: string }).token;
    } catch {
      /* dev gateway runs open */
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(GATEWAY_URL);
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          sessionId,
          ...(token ? { token } : {}),
          vertical: 'THERAPIST',
          kind,
          modality,
          therapyContext: {
            carriedQuestions,
            priorRisk,
            plannedMinutes: plannedMinutes ?? null,
          },
        }),
      );
      // Replay plan items the therapist resolved before the connection existed,
      // so the gateway's store doesn't re-suggest them.
      for (const id of resolvedRef.current) {
        ws.send(JSON.stringify({ type: 'dismiss', questionId: id }));
      }
      void stream.start().catch((e: Error) => {
        setError(`Microphone unavailable: ${e.message}. Tap Start to try again.`);
        setPhase('idle');
        ws.close();
      });
    };

    ws.onerror = () => {
      setPhase('error');
      setError(
        `Couldn't reach the live gateway at ${GATEWAY_URL}. Start it with: pnpm --filter @cureocity/live-gateway dev`,
      );
    };

    // AUD2 — a clean close (gateway restart/crash/deploy) previously left the
    // screen on "listening" forever while frames were silently dropped. If we
    // were mid-session and no final note arrived, stop the mic and surface a
    // recovery card (reconnect, or continue the classic recorded way).
    ws.onclose = () => {
      if (finalHandledRef.current) return;
      const p = phaseRef.current;
      if (p === 'listening' || p === 'finalizing') {
        void streamRef.current.stop();
        setConnectionLost(true);
        setPhase('error');
      }
    };

    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const parsed = LiveGatewayEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      switch (event.type) {
        case 'status':
          if (event.state === 'listening') setPhase('listening');
          else if (event.state === 'finalizing') setPhase('finalizing');
          else if (event.state === 'done') {
            setPhase('done');
            // The gateway always sends `done` after a therapyFinal. If we get
            // here without one, no note was generated (Pass 2 empty/blocked) —
            // surface a recovery panel instead of hanging on "Finishing…".
            if (!finalHandledRef.current) setNoteFailed(true);
          } else if (event.state === 'unauthorized' || event.state === 'busy') {
            setPhase('error');
            setError(
              event.state === 'busy'
                ? 'The live scribe is at capacity — try again in a moment, or record the batch way.'
                : 'The live session could not be authorized.',
            );
          }
          break;
        case 'utterance':
          setUtterances((prev) => [...prev, event.utterance]);
          break;
        case 'therapyNote':
          setNote(event.note as Record<string, unknown>);
          setNoteUpdatedAt(Date.now());
          setRefreshingNote(false);
          break;
        case 'therapyReasoning':
          setCopilot(event.reasoning);
          break;
        case 'meter':
          meterRef.current = event.summary;
          break;
        case 'therapyFinal':
          setNote(event.note as unknown as Record<string, unknown>);
          setNoteUpdatedAt(Date.now());
          void persistAndFinish(
            event.kind,
            event.note,
            event.transcript ?? buildTranscript(utterances),
          );
          break;
        default:
          break;
      }
    };
  }

  function end(): void {
    if (phase !== 'listening') return;
    setPhase('finalizing');
    void stream.stop();
    wsRef.current?.send(JSON.stringify({ type: 'stop' }));
  }

  /** TS-B3 — "Update now": ask the gateway for an immediate note refresh. */
  function updateNoteNow(): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN || phase !== 'listening' || refreshingNote) return;
    ws.send(JSON.stringify({ type: 'refreshNote' }));
    setRefreshingNote(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // If nothing changed, no event comes back — quietly re-enable the button.
    refreshTimerRef.current = setTimeout(() => setRefreshingNote(false), 12_000);
  }

  /** Sprint TS5 — relay one copilot-suggestion lifecycle event to the audit
   *  trail (best-effort; the gateway can't touch the DB, the browser relays). */
  function relaySuggestion(
    event: 'shown' | 'acted' | 'dismissed',
    suggestionId: string,
    suggestionKind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    label?: string,
  ): void {
    void fetch(`/api/v1/sessions/${sessionId}/live-suggestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event,
        suggestionId,
        kind: suggestionKind,
        ...(label ? { label } : {}),
      }),
    }).catch(() => {
      /* audit is best-effort */
    });
  }

  /** Acted / dismissed a copilot card: stop the gateway re-suggesting it +
   *  record the outcome. "acted" (Asked ✓ / Explore) and "dismissed" both
   *  resolve the card so it leaves the rail. */
  function resolveCopilot(
    id: string,
    suggestionKind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    event: 'acted' | 'dismissed',
    label?: string,
  ): void {
    // Optimistic: the card leaves the rail immediately (also covers resolving
    // a seeded plan item before the gateway is connected).
    resolvedRef.current.add(id);
    setResolvedIds((prev) => new Set(prev).add(id));
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'dismiss', questionId: id }));
    }
    relaySuggestion(event, id, suggestionKind, label);
  }

  const sorted = [...utterances].sort((a, b) => a.tStartMs - b.tStartMs);
  const risk = readRisk(note);
  const sections = noteSections(kind, note);
  const filledCount = sections.filter((s) => s.value.trim().length > 0).length;
  const topics = kind === 'INTAKE' ? [] : noteTopics(note);
  const coverage = kind === 'INTAKE' ? intakeCoverage(note) : [];
  const balance = talkBalance(utterances);
  const hearing = hearingCodes(utterances);
  const clientFirst = clientName?.trim().split(/\s+/)[0] || 'Client';
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const updatedAgo =
    noteUpdatedAt !== null ? Math.max(0, Math.round((Date.now() - noteUpdatedAt) / 1000)) : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">{clientName || 'Live session'}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-0.5 text-xs text-[var(--color-ink-2)]">
              {kind === 'INTAKE' ? 'Intake' : kind === 'REVIEW' ? 'Review' : 'Treatment session'}
            </span>
            {modality && (
              <span className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-0.5 text-xs text-[var(--color-ink-2)]">
                {modality}
              </span>
            )}
            <span className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-0.5 text-xs text-[var(--color-ink-2)]">
              Note: {LANGUAGE_LABEL[language] ?? language}
            </span>
            {hearing.length > 0 && (
              <span className="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-xs text-[var(--color-accent)]">
                Hearing: {hearing.join(' · ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          {phase === 'listening' && (
            <span className="flex items-center gap-2 text-sm tabular-nums text-[var(--color-ink-2)]">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              {mm}:{ss}
            </span>
          )}
          {phase === 'listening' && <Button onClick={end}>End session</Button>}
          {(phase === 'finalizing' || saving) && (
            <span className="text-sm text-[var(--color-ink-3)]">Finishing the note…</span>
          )}
        </div>
      </header>

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}

      {connectionLost && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">The live connection dropped.</strong>
          <p className="mt-1">
            The scribe lost its link to the gateway mid-session. The session itself is safe — what
            was already transcribed is on this screen, but nothing new is being heard. Reconnect to
            continue live, or switch to the classic recorder (it reuses this same session).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void start()}>Reconnect</Button>
            {clientId && (
              <Button variant="secondary" onClick={() => router.push(`/app?record=${clientId}`)}>
                Continue as recording
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.push(`/app/sessions/${sessionId}`)}>
              Open session
            </Button>
          </div>
        </Card>
      )}

      {noteFailed && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">The note couldn’t be generated automatically.</strong>
          <p className="mt-1">
            The session ended but the AI note didn’t come back (the transcriber may have returned
            nothing for this audio). Your session isn’t lost — you can try the live scribe again, or
            open the session to record or write the note there.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void start()}>Try again</Button>
            <Button variant="secondary" onClick={() => router.push(`/app/sessions/${sessionId}`)}>
              Open session
            </Button>
          </div>
        </Card>
      )}

      {phase === 'idle' && (
        <div className="space-y-4">
          <Card className="p-8 text-center">
            <p className="mb-4 text-sm text-[var(--color-ink-2)]">
              The conversation and note build in real time as you talk.
            </p>
            <Button onClick={() => void start()}>Start session</Button>
          </Card>

          {/* TS5.4 — the session plan is visible BEFORE recording starts:
              the carried questions + the copilot's ranked open questions,
              plus the prior-risk re-check. Same cards as the live rail. */}
          {effectiveCopilot &&
            (effectiveCopilot.askNext.length > 0 || effectiveCopilot.riskWatch.length > 0) && (
              <div className="mx-auto max-w-xl">
                <TherapyCopilotRail reasoning={effectiveCopilot} onResolve={resolveCopilot} />
              </div>
            )}
        </div>
      )}

      {phase !== 'idle' && (
        <div className="grid items-start gap-4 lg:grid-cols-12">
          {/* ============ Conversation ============ */}
          <Card className="p-4 lg:col-span-7">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Conversation
              </h2>
              <span className="text-xs text-[var(--color-ink-3)]">auto-scrolls</span>
            </div>

            {balance && (
              <div className="mt-3 flex items-center gap-2.5 text-xs text-[var(--color-ink-3)]">
                <span className="whitespace-nowrap">
                  {clientFirst} {balance.client}%
                </span>
                <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                  <div
                    className="bg-[var(--color-accent)] opacity-80"
                    style={{ width: `${balance.client}%` }}
                  />
                  <div className="bg-[#c9b98f]" style={{ width: `${balance.you}%` }} />
                </div>
                <span className="whitespace-nowrap">You {balance.you}%</span>
              </div>
            )}

            <div ref={convoRef} className="mt-3 flex max-h-[62vh] flex-col gap-3 overflow-y-auto">
              {sorted.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-3)]">Listening…</p>
              ) : (
                sorted.map((u) => {
                  const who =
                    u.speaker === 'doctor' ? 'You' : u.speaker === 'patient' ? clientFirst : null;
                  const align =
                    u.speaker === 'doctor' ? 'items-end self-end' : 'items-start self-start';
                  const bubble =
                    u.speaker === 'doctor'
                      ? 'bg-[var(--color-accent-soft)] border border-[#d8e6de] rounded-tr-sm'
                      : u.speaker === 'patient'
                        ? 'bg-[var(--color-surface-soft)] border border-[var(--color-line-soft)] rounded-tl-sm'
                        : 'border border-dashed border-[var(--color-line)] italic text-[var(--color-ink-3)] rounded-tl-sm';
                  return (
                    <div key={u.id} className={`flex max-w-[82%] flex-col gap-0.5 ${align}`}>
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                        {who ?? 'Unclear'}{' '}
                        <span className="font-normal normal-case tabular-nums">
                          · {fmtClock(u.tStartMs)}
                        </span>
                      </span>
                      <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${bubble}`}>
                        {u.text}
                      </div>
                    </div>
                  );
                })
              )}
              {phase === 'listening' && sorted.length > 0 && (
                <div className="flex items-center gap-2 pt-1 text-xs text-[var(--color-ink-3)]">
                  <span className="flex gap-1">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-ink-3)]" />
                    <span
                      className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-ink-3)]"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <span
                      className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-ink-3)]"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </span>
                  Listening…
                </div>
              )}
            </div>
          </Card>

          {/* ============ Right rail ============ */}
          <div className="space-y-4 lg:col-span-5">
            {/* Sprint TS5 → TS5.4 — the live copilot. Renders from the FIRST
                moment: the seeded session plan (carried + copilot questions,
                prior-risk re-check) until the gateway's first reasoning
                snapshot replaces it. A Pass-2 note-level risk still escalates
                the fallback card when there is no plan at all. */}
            {effectiveCopilot ? (
              <TherapyCopilotRail reasoning={effectiveCopilot} onResolve={resolveCopilot} />
            ) : risk ? (
              <Card
                className={`p-4 text-sm ${
                  risk.severity === 'critical' || risk.severity === 'high'
                    ? 'border-red-300 bg-red-50 text-red-800'
                    : 'border-amber-300 bg-amber-50 text-amber-800'
                }`}
              >
                <strong className="uppercase tracking-wide">Safety · {risk.severity}</strong>
                <p className="mt-1">{risk.text}</p>
              </Card>
            ) : (
              <Card className="flex items-start gap-2.5 p-4">
                <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--color-accent)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-ink)]">
                    Copilot — warming up
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                    Risk cues, questions to ask, and unexplored threads appear here as you talk.
                  </p>
                </div>
              </Card>
            )}

            {/* What to explore — intake coverage (B5) */}
            {kind === 'INTAKE' && (
              <Card className="p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                  What to explore
                </h2>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {coverage.map((c) => (
                    <span
                      key={c.label}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        c.done
                          ? 'border-[#d8e6de] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'border-[var(--color-line)] text-[var(--color-ink-3)]'
                      }`}
                    >
                      {c.done ? '✓' : '○'} {c.label}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--color-ink-3)]">
                  Read from the note as it builds — cover the open circles before you wrap up.
                </p>
              </Card>
            )}

            {/* Live note */}
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                  Live note
                </h2>
                <span className="flex-1" />
                <span className="text-xs text-[var(--color-ink-3)]">
                  {refreshingNote
                    ? 'Updating…'
                    : updatedAgo !== null
                      ? `Updated ${updatedAgo}s ago`
                      : 'Writing…'}
                </span>
                {phase === 'listening' && (
                  <button
                    type="button"
                    onClick={updateNoteNow}
                    disabled={refreshingNote}
                    className="rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-accent)] disabled:opacity-50"
                  >
                    Update now
                  </button>
                )}
              </div>

              <div className="mt-3 flex max-h-[52vh] flex-col gap-3.5 overflow-y-auto">
                {sections.map((s) => (
                  <div key={s.label}>
                    <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
                      {s.label}
                    </div>
                    {s.value.trim() ? (
                      <p className="mt-0.5 whitespace-pre-line text-sm text-[var(--color-ink)]">
                        {s.value}
                      </p>
                    ) : (
                      <div className="mt-1.5 space-y-1.5">
                        <div className="h-2.5 animate-pulse rounded bg-[var(--color-line-soft)]" />
                        <div className="h-2.5 w-3/5 animate-pulse rounded bg-[var(--color-line-soft)]" />
                      </div>
                    )}
                  </div>
                ))}
                {filledCount === 0 && (
                  <p className="text-xs italic text-[var(--color-ink-3)]">
                    Fills in as the session gives it material…
                  </p>
                )}
              </div>

              {topics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-line-soft)] pt-3">
                  {topics.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-[var(--color-line)] bg-white px-2.5 py-0.5 text-xs text-[var(--color-ink-2)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            {meterRef.current && (
              <p className="pr-1 text-right text-xs tabular-nums text-[var(--color-ink-3)]">
                ₹{meterRef.current.costInr.toFixed(2)} this session
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
