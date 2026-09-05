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
import Link from 'next/link';
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
import {
  clearRecoveryDraftAfterDurableSave,
  hasUniqueUnsavedContent,
  loadRecoveryDraft,
  saveRecoveryDraft,
  shouldResumeRecovery,
} from '@/lib/live-recovery-draft';
import { transcriptDownload } from '@/lib/mind-session-finalization';
import { coordinateMindSessionStart } from '@/lib/mind-session-start';
import {
  markCopilotSuggestionShown,
  type DisclosedCopilotSuggestion,
} from '@/lib/therapy-copilot-disclosure';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { GatewayMockBanner } from './GatewayMockBanner';
import { TherapyCopilotRail } from './TherapyCopilotRail';
import { MindTherapyGuide, type PreparedMindGuide } from './MindTherapyGuide';

const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

interface Props {
  sessionId: string;
  sessionStatus?: 'SCHEDULED' | 'IN_PROGRESS';
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
  selectedDeviceId?: string;
  preparedGuides?: PreparedMindGuide[];
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
  sessionStatus = 'SCHEDULED',
  clientId = null,
  kind,
  modality,
  language,
  clientName,
  autoStart,
  carriedQuestions = [],
  priorRisk = false,
  plannedMinutes = null,
  selectedDeviceId,
  preparedGuides = [],
}: Props) {
  const router = useRouter();
  const [workspaceMode, setWorkspaceMode] = useState<'quiet' | 'guided'>('quiet');
  const [showTranscript, setShowTranscript] = useState(false);
  const [guideId, setGuideId] = useState('');
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
  // The finished note failed to persist (encryption outage / network). The
  // browser is the ONLY holder of the live note + transcript, so this state
  // must never silently redirect — it renders a retry card instead.
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  // The live-token 409: the client's consents on record don't cover the live
  // scribe. Rendered with the real reason + the path to capture consent,
  // instead of the gateway's generic "could not be authorized".
  const [consentBlocked, setConsentBlocked] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [recoveryRestored, setRecoveryRestored] = useState(false);
  const [finalStage, setFinalStage] = useState<
    'stopping' | 'saving-transcript' | 'generating-note' | 'ready' | null
  >(null);

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
  const lifecycleStartedRef = useRef(sessionStatus === 'IN_PROGRESS');
  const convoRef = useRef<HTMLDivElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live mirror of the utterance list — long-lived closures (ws.onmessage,
  // the reconnect path) must read the CURRENT transcript, not a stale capture.
  const utterancesRef = useRef<Utterance[]>([]);
  useEffect(() => {
    utterancesRef.current = utterances;
  }, [utterances]);

  // Restore browser-held words before any retry can start. The recovery copy
  // is refreshed on every utterance and remains until the server acknowledges
  // the final durable note/transcript write.
  useEffect(() => {
    const recovered = loadRecoveryDraft(window.localStorage, sessionId);
    if (!recovered || recovered.utterances.length === 0) return;
    const restored = recovered.utterances as Utterance[];
    utterancesRef.current = restored;
    setUtterances(restored);
    setRecoveryRestored(true);
  }, [sessionId]);
  useEffect(() => {
    if (utterances.length === 0) return;
    saveRecoveryDraft(window.localStorage, {
      version: 1,
      sessionId,
      savedAt: new Date().toISOString(),
      utterances,
      transcript: buildTranscript(utterances),
      captureMode: 'LIVE',
      durable: false,
    });
  }, [sessionId, utterances]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const draft = loadRecoveryDraft(window.localStorage, sessionId);
      if (!hasUniqueUnsavedContent(draft)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onDocumentClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!anchor) return;
      const draft = loadRecoveryDraft(window.localStorage, sessionId);
      if (!hasUniqueUnsavedContent(draft)) return;
      if (
        window.confirm(
          'This session has transcript content that is not saved on the server yet. Leave anyway?',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, [sessionId]);
  // The final payload, kept so a failed save can be retried verbatim.
  const finalPayloadRef = useRef<{
    kind: SessionKind;
    note: TherapyNoteV1 | IntakeNoteV1;
    transcript: string;
  } | null>(null);

  const stream = useLiveStream({
    ...(selectedDeviceId ? { selectedDeviceId } : {}),
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
      void start({ resume: utterancesRef.current.length > 0 });
    }
  }, [autoStart, phase]);

  // The rail reports disclosure, not model receipt: Quiet/collapsed cards
  // cannot inflate shown counts. Keep the existing once-per-session semantics.
  const shownIdsRef = useRef({ sessionId, ids: new Set<string>() });
  function reportShownCopilot(items: DisclosedCopilotSuggestion[]): void {
    for (const item of items) {
      if (!markCopilotSuggestionShown(shownIdsRef.current, sessionId, item.id)) continue;
      relaySuggestion('shown', item.id, item.kind, item.label);
    }
  }

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
    finalPayloadRef.current = { kind: finalKind, note: finalNote, transcript };
    setSaveFailed(null);
    setSaving(true);
    setFinalStage('saving-transcript');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/live-note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: finalKind,
          note: finalNote,
          ...(transcript ? { transcript } : {}),
        }),
      });
      if (!res.ok) {
        // The live path records no audio — this browser is the only holder of
        // the note + transcript. A 503 (encryption outage) or any refusal must
        // surface a retry, never redirect and drop it.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The server refused the note (HTTP ${res.status}).`);
      }
      if (meterRef.current) void persistMeter(meterRef.current);
      setFinalStage('ready');
      clearRecoveryDraftAfterDurableSave(window.localStorage, sessionId, true);
      // The note is a COMPLETED NoteDraft now. Land on the copilot board —
      // review + sign live there, and no generation wait stands in the way.
      router.push(`/app/sessions/${sessionId}`);
      router.refresh();
    } catch (e) {
      finalHandledRef.current = false; // retry stays possible
      setSaving(false);
      setSaveFailed((e as Error).message);
    }
  }

  /** Re-POST the finished note after a failed save (same payload, verbatim). */
  function retrySave(): void {
    const p = finalPayloadRef.current;
    if (!p) return;
    void persistAndFinish(p.kind, p.note, p.transcript);
  }

  async function copyHeldTranscript(): Promise<void> {
    const transcript =
      finalPayloadRef.current?.transcript ?? buildTranscript(utterancesRef.current);
    await navigator.clipboard.writeText(transcript);
  }

  function downloadHeldTranscript(): void {
    const transcript =
      finalPayloadRef.current?.transcript ?? buildTranscript(utterancesRef.current);
    const file = transcriptDownload(sessionId, transcript);
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function continueAsBatch(): void {
    const transcript = buildTranscript(utterancesRef.current);
    if (transcript) {
      saveRecoveryDraft(window.localStorage, {
        version: 1,
        sessionId,
        savedAt: new Date().toISOString(),
        utterances: utterancesRef.current,
        transcript,
        captureMode: 'BATCH',
        durable: false,
      });
    }
    if (clientId) router.push(`/app?record=${clientId}&session=${sessionId}&capture=BATCH`);
  }

  async function start(opts: { resume?: boolean } = {}): Promise<void> {
    // Reconnect path: the browser still holds the transcript — keep it on
    // screen and replay it to the gateway (`resume`) so the consult continues
    // from the whole session, not just what it hears after the drop.
    const resume = shouldResumeRecovery(utterancesRef.current.length, opts.resume === true);
    setError(null);
    setNoteFailed(false);
    setConnectionLost(false);
    setConsentBlocked(null);
    setSaveFailed(null);
    if (!resume) {
      setUtterances([]);
      setNote({});
      setNoteUpdatedAt(null);
      setElapsed(0);
      meteredRef.current = false;
      meterRef.current = null;
    }
    setRefreshingNote(false);
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
      if (r.ok) {
        token = ((await r.json()) as { token?: string }).token;
      } else if (r.status === 409) {
        // The one refusal the therapist can actually fix here: the client's
        // consents on record don't cover the live scribe (or were withdrawn).
        // Surface the server's real reason + the capture path, instead of
        // proceeding tokenless into the gateway's generic "unauthorized".
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setPhase('error');
        setConsentBlocked(
          body.error ?? "The client's consents on record don't cover the live scribe.",
        );
        return;
      }
      // Other non-OK responses: proceed tokenless — the dev gateway runs
      // open, and a secured gateway will refuse below with `unauthorized`.
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
      void coordinateMindSessionStart(
        { clientId: clientId ?? '', sessionId, captureMode: 'LIVE' },
        {
          selectOrReuseSession: async () => ({
            id: sessionId,
            status: lifecycleStartedRef.current ? 'IN_PROGRESS' : 'SCHEDULED',
          }),
          // Scheduled pages can reach this point only through the same-session
          // preflight; live-token above also verified the durable snapshot.
          resolveConsent: async () => ({ sessionId, snapshotRecorded: true }),
          runPreflight: async () => ({ ready: true }),
          activateCapture: async () => {
            try {
              await stream.start();
              return { active: true as const };
            } catch (reason) {
              return { active: false as const, reason: (reason as Error).message };
            }
          },
          authorizeCapture: async () => {
            const response = await fetch(`/api/v1/sessions/${sessionId}/start`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ captureMode: 'LIVE' }),
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(body.error ?? `Could not mark capture active (${response.status}).`);
            }
            lifecycleStartedRef.current = true;
          },
        },
      )
        .then(() => {
          const replay = resume ? utterancesRef.current : [];
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
              // The gateway re-seeds its transcript + reasoning state from the
              // replayed tail, so the final note covers the WHOLE session.
              ...(replay.length > 0 ? { resume: { utterances: replay } } : {}),
            }),
          );
          for (const id of resolvedRef.current) {
            ws.send(JSON.stringify({ type: 'dismiss', questionId: id }));
          }
        })
        .catch((reason: unknown) => {
          setError(`Microphone unavailable: ${(reason as Error).message}. Tap Start to try again.`);
          setPhase('idle');
          ws.close();
        });
    };

    ws.onerror = () => {
      // Mid-session an error event is always followed by close — the
      // recovery card (onclose) owns that path. Only a failed initial
      // connect reports the connect-time message.
      if (phaseRef.current !== 'connecting') return;
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
          else if (event.state === 'finalizing') {
            setPhase('finalizing');
            setFinalStage('generating-note');
          } else if (event.state === 'done') {
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
            event.transcript ?? buildTranscript(utterancesRef.current),
          );
          break;
        default:
          break;
      }
    };
  }

  function end(): void {
    if (phase !== 'listening') return;
    setEndConfirmOpen(true);
  }

  function confirmEnd(): void {
    if (phase !== 'listening') return;
    setEndConfirmOpen(false);
    setFinalStage('stopping');
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
  const selectedGuide = preparedGuides.find((guide) => guide.id === guideId);
  const hasGuide = workspaceMode === 'guided' && selectedGuide !== undefined;
  const showConversation = showTranscript && phase !== 'idle';

  return (
    <div className="space-y-4">
      <GatewayMockBanner />
      <header className="mind-live-header sticky top-0 z-30 flex flex-wrap items-start justify-between gap-3 bg-[var(--color-surface)]/95 backdrop-blur md:static">
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
            <span className="text-sm text-[var(--color-ink-3)]">
              {finalStage === 'stopping'
                ? 'Stopping capture…'
                : finalStage === 'saving-transcript'
                  ? 'Saving transcript…'
                  : finalStage === 'ready'
                    ? 'Ready to review'
                    : 'Generating note…'}
            </span>
          )}
        </div>
      </header>

      <div className="mind-live-modes">
        <div>
          <div className="mind-mode-picker" role="group" aria-label="Live workspace mode">
            <button
              type="button"
              aria-pressed={workspaceMode === 'quiet'}
              onClick={() => setWorkspaceMode('quiet')}
            >
              Quiet focus
            </button>
            <button
              type="button"
              aria-pressed={workspaceMode === 'guided'}
              onClick={() => setWorkspaceMode('guided')}
            >
              Guided session
            </button>
          </div>
          <p className="mind-capture-note mt-2">
            {workspaceMode === 'quiet'
              ? 'Stay with the client. Your note builds alongside you.'
              : 'Your questions, your chosen guide. Change direction whenever you need.'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={showTranscript}
          onClick={() => setShowTranscript((value) => !value)}
        >
          {showTranscript ? 'Hide transcript' : 'Show transcript'}
        </Button>
      </div>

      {workspaceMode === 'guided' && preparedGuides.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <label className="text-sm font-medium" htmlFor={`guide-${sessionId}`}>
            Previously prepared guide
          </label>
          <select
            id={`guide-${sessionId}`}
            value={guideId}
            onChange={(event) => setGuideId(event.target.value)}
            className="max-w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            <option value="">Choose a guide to review</option>
            {preparedGuides.map((guide) => (
              <option key={guide.id} value={guide.id}>
                {guide.body.therapyName} ·{' '}
                {new Date(guide.updatedAt).toLocaleDateString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  month: 'short',
                  day: 'numeric',
                })}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--color-ink-2)]">
            Recheck the draft against today’s case. Opening it does not confirm a plan or
            intervention.
          </p>
        </div>
      )}

      {workspaceMode === 'guided' && preparedGuides.length === 0 && (
        <Card className="p-4 text-sm text-[var(--color-ink-2)]">
          <p>
            No prepared guide is available for this session. You can use the questions below and
            continue your own assessment.
          </p>
          {phase === 'idle' && clientId && (
            <p className="mt-2">
              <Link
                className="font-medium text-[var(--color-accent)] underline"
                href={`/app/clients/${clientId}/plan#session-guides`}
              >
                Prepare a guide from the client’s plan before recording
              </Link>
            </p>
          )}
        </Card>
      )}

      {workspaceMode === 'quiet' &&
        selectedGuide &&
        selectedGuide.body.riskWatchpoints.length > 0 && (
          <section
            className="rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]"
            aria-label="Selected guide watchpoints"
          >
            <h2 className="font-semibold">
              Selected guide watchpoints · {selectedGuide.body.therapyName}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {selectedGuide.body.riskWatchpoints.map((cue, index) => (
                <li key={index}>{cue}</li>
              ))}
            </ul>
          </section>
        )}

      {risk && (
        <Card
          className={`mind-live-safety p-4 text-sm ${risk.severity === 'critical' || risk.severity === 'high' ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
        >
          <strong>Safety concern in the draft · {risk.severity}</strong>
          <p className="mt-1">{risk.text}</p>
        </Card>
      )}

      {recoveryRestored && (
        <Card className="border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 text-sm">
          Restored the transcript held by this browser. Reconnect continues the same session without
          clearing those words.
        </Card>
      )}

      {endConfirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="End session?"
        >
          <Card className="w-full max-w-md p-6">
            <h2 className="font-serif text-xl">End this session?</h2>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Capture will stop and the transcript will be saved before the note is generated.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEndConfirmOpen(false)}>
                Keep recording
              </Button>
              <Button onClick={confirmEnd}>End &amp; save</Button>
            </div>
          </Card>
        </div>
      )}

      {finalStage === 'generating-note' && !saveFailed && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>The transcript is held safely. Note generation continues on the server.</span>
          <Button variant="secondary" onClick={() => router.push('/app/today')}>
            Return to Today
          </Button>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
          {phase === 'error' && !connectionLost && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void start({ resume: utterances.length > 0 })}>
                Try again
              </Button>
              {clientId && (
                <Button variant="secondary" onClick={() => router.push(`/app?record=${clientId}`)}>
                  Record the classic way
                </Button>
              )}
              <Button variant="secondary" onClick={() => router.push(`/app/sessions/${sessionId}`)}>
                Open session
              </Button>
            </div>
          )}
        </Card>
      )}

      {consentBlocked && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">Consent is missing for the live scribe.</strong>
          <p className="mt-1">{consentBlocked}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {clientId && (
              <Button onClick={() => router.push(`/app?record=${clientId}`)}>
                Capture consent &amp; start
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void start({ resume: utterances.length > 0 })}
            >
              Try again
            </Button>
          </div>
        </Card>
      )}

      {saveFailed && (
        <Card className="border-red-300 bg-red-50 p-5 text-sm text-red-900">
          <strong className="block">The note is finished but could not be saved.</strong>
          <p className="mt-1">
            {saveFailed} Nothing is lost while this tab stays open — the note and transcript are
            held right here. Retry the save; if it keeps failing, keep this tab open and try again
            in a minute.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={retrySave} disabled={saving}>
              {saving ? 'Saving…' : 'Retry finalization'}
            </Button>
            <Button variant="secondary" onClick={() => void copyHeldTranscript()}>
              Copy transcript
            </Button>
            <Button variant="secondary" onClick={downloadHeldTranscript}>
              Save transcript
            </Button>
            <Button variant="secondary" onClick={() => router.push('/app/today')}>
              Return to Today
            </Button>
          </div>
        </Card>
      )}

      {connectionLost && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">The live connection dropped.</strong>
          <p className="mt-1">
            The scribe lost its link to the gateway mid-session. What was already transcribed is on
            this screen and will carry over — Reconnect continues the same session (the transcript
            so far is replayed to the scribe), or switch to the classic recorder (it reuses this
            same session).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void start({ resume: true })}>Reconnect</Button>
            {clientId && (
              <Button variant="secondary" onClick={continueAsBatch}>
                Continue as recording (transcript preserved)
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
            <Button onClick={() => void start({ resume: utterances.length > 0 })}>
              Retry finalization
            </Button>
            <Button variant="secondary" onClick={downloadHeldTranscript}>
              Save transcript
            </Button>
            <Button variant="secondary" onClick={() => router.push('/app/today')}>
              Return to Today
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/app/sessions/${sessionId}`)}>
              Open session
            </Button>
          </div>
        </Card>
      )}

      {/* Safety stays ahead of the guide in both modes, at every recording phase. */}
      {effectiveCopilot && (
        <TherapyCopilotRail
          reasoning={effectiveCopilot}
          onResolve={resolveCopilot}
          onShown={reportShownCopilot}
          mode={workspaceMode}
        />
      )}

      {/* One stable guide instance: starting/stopping capture must not discard its review state. */}
      <div className="grid items-start gap-4 lg:grid-cols-12">
        {/* ============ Conversation ============ */}
        <div
          className={`space-y-4 lg:col-span-7 ${!showConversation && !hasGuide ? 'hidden' : ''}`}
        >
          {selectedGuide && (
            <div hidden={workspaceMode !== 'guided'}>
              <MindTherapyGuide
                key={selectedGuide.id + selectedGuide.updatedAt}
                script={selectedGuide.body}
              />
            </div>
          )}
          <Card className={`p-4 ${showConversation ? '' : 'hidden'}`}>
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
        </div>

        {/* ============ Right rail ============ */}
        <div
          className={`space-y-4 ${!showConversation && !hasGuide ? 'lg:col-span-12' : 'lg:col-span-5'}`}
        >
          {phase === 'idle' ? (
            <Card className="p-8 text-center">
              <p className="mb-4 text-sm text-[var(--color-ink-2)]">
                The conversation and note build in real time as you talk. Recording starts only when
                you choose.
              </p>
              <Button onClick={() => void start({ resume: utterances.length > 0 })}>
                Start session
              </Button>
            </Card>
          ) : (
            <>
              {!effectiveCopilot && (
                <Card className="flex items-start gap-2.5 p-4">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--color-accent)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">
                      Session companion — waiting for context
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                      No live guidance yet. Continue your own assessment; the absence of an alert is
                      not a safety assessment.
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
                    Draft coverage, not a completed assessment. Explore what is appropriate; never
                    fill a field just to complete the list.
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
