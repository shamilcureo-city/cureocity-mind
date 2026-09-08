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
 * needs real-device/gateway validation beyond the isolated React/mock CI tests.
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
import { LiveTokenRenewal, type LiveTokenLease } from '@/lib/audio/live-token-renewal';
import { useWakeLock } from '@/lib/audio/use-wake-lock';
import {
  browserRecoveryStorage,
  clearRecoveryDraftAfterDurableSave,
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

type Phase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'pausing'
  | 'paused'
  | 'pause-unconfirmed'
  | 'finalizing'
  | 'done'
  | 'error';

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
  initialGuideId?: string;
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
  initialGuideId,
}: Props) {
  const router = useRouter();
  const initialGuide = preparedGuides.find((guide) => guide.id === initialGuideId);
  const [workspaceMode, setWorkspaceMode] = useState<'quiet' | 'guided'>(
    initialGuide ? 'guided' : 'quiet',
  );
  const [showTranscript, setShowTranscript] = useState(false);
  const [guideId, setGuideId] = useState(initialGuide?.id ?? '');
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
  const [localRecoveryFailed, setLocalRecoveryFailed] = useState(false);
  const durableRef = useRef(false);
  const startingRef = useRef(false);
  const liveAttemptRef = useRef(0);
  const attemptAbortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);
  const audioDeliveryRef = useRef<'off' | 'buffering' | 'sending'>('off');
  const startupAudioRef = useRef<Uint8Array[]>([]);
  const startupAudioBytesRef = useRef(0);
  const captureIntegrityErrorRef = useRef(false);
  const pauseReplyRef = useRef<{
    requestId: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [pauseWarning, setPauseWarning] = useState<string | null>(null);
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
  const renewalRef = useRef<LiveTokenRenewal | null>(null);
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
    const recovered = loadRecoveryDraft(browserRecoveryStorage(), sessionId);
    if (!recovered || recovered.utterances.length === 0) return;
    const restored = recovered.utterances as Utterance[];
    utterancesRef.current = restored;
    setUtterances(restored);
    setRecoveryRestored(true);
  }, [sessionId]);
  useEffect(() => {
    if (utterances.length === 0) return;
    durableRef.current = false;
    const saved = saveRecoveryDraft(browserRecoveryStorage(), {
      version: 1,
      sessionId,
      savedAt: new Date().toISOString(),
      utterances,
      transcript: buildTranscript(utterances),
      captureMode: 'LIVE',
      durable: false,
    });
    setLocalRecoveryFailed(!saved);
  }, [sessionId, utterances]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (durableRef.current || (!utterancesRef.current.length && !finalPayloadRef.current)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onDocumentClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!anchor) return;
      if (durableRef.current || (!utterancesRef.current.length && !finalPayloadRef.current)) return;
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
      if (audioDeliveryRef.current === 'buffering') {
        if (startupAudioBytesRef.current + pcm.byteLength > 1_048_576) {
          audioDeliveryRef.current = 'off';
          setError(
            'The live connection did not become ready. Capture stopped; the startup audio was not transcribed. Retry before continuing the conversation.',
          );
          setPhase('error');
          void streamRef.current.stop().catch(() => {});
          ws?.close();
          return;
        }
        startupAudioRef.current.push(pcm);
        startupAudioBytesRef.current += pcm.byteLength;
      } else if (audioDeliveryRef.current === 'sending' && ws && ws.readyState === ws.OPEN)
        ws.send(pcm);
    },
    onInterrupted: (message) => {
      audioDeliveryRef.current = 'off';
      setError(message);
      setConnectionLost(true);
      setPhase('error');
      wsRef.current?.close();
    },
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;
  // AUD2 — ws.onclose is a long-lived closure; it reads the CURRENT phase
  // through this ref rather than a stale capture.
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      audioDeliveryRef.current = 'off';
      pauseReplyRef.current?.reject(new Error('This page closed.'));
      startingRef.current = false;
      autoStartedRef.current = false;
      ++liveAttemptRef.current;
      attemptAbortRef.current?.abort();
      renewalRef.current?.dispose();
      renewalRef.current = null;
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
      void streamRef.current.stop().catch(() => {});
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
      durableRef.current = true;
      clearRecoveryDraftAfterDurableSave(browserRecoveryStorage(), sessionId, true);
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

  function navigateAway(href: string): void {
    if (!durableRef.current && (utterancesRef.current.length || finalPayloadRef.current)) {
      setError(
        'This session has unsaved work. Save the transcript or finish saving before leaving this page.',
      );
      return;
    }
    router.push(href);
  }

  async function recoverTranscript(action: 'CONTINUE_RECORDING' | 'FINALIZE'): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    ++liveAttemptRef.current;
    attemptAbortRef.current?.abort();
    startingRef.current = false;
    renewalRef.current?.dispose();
    renewalRef.current = null;
    try {
      await streamRef.current.stop();
      // Recovery uses captured words; it never reacquires a microphone or fabricates a note.
      finalHandledRef.current = true;
      wsRef.current?.close();
      if (utterancesRef.current.length) {
        const response = await fetch(`/api/v1/sessions/${sessionId}/recovery-transcript`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ action, utterances: utterancesRef.current }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? 'Captured words could not be saved. Keep this tab open.');
        }
        durableRef.current = true;
        clearRecoveryDraftAfterDurableSave(browserRecoveryStorage(), sessionId, true);
      } else if (action === 'FINALIZE') {
        throw new Error(
          'No captured words are available. Resume recording or open the session to document manually.',
        );
      }
      if (action === 'CONTINUE_RECORDING') {
        if (clientId) router.push(`/app?record=${clientId}&session=${sessionId}&capture=BATCH`);
      } else {
        setFinalStage('generating-note');
        const generated = await fetch(`/api/v1/sessions/${sessionId}/generate-note`, {
          method: 'POST',
          keepalive: true,
        });
        if (!generated.ok)
          throw new Error(
            'Transcript saved securely, but the note needs a retry. Open the session to continue.',
          );
        router.push(`/app/sessions/${sessionId}`);
      }
    } catch (reason) {
      finalHandledRef.current = false;
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function continueAsBatch(): void {
    void recoverTranscript('CONTINUE_RECORDING');
  }

  async function start(opts: { resume?: boolean } = {}): Promise<void> {
    if (unmountedRef.current || startingRef.current || saving) return;
    if (captureIntegrityErrorRef.current) {
      setError(
        'The last audio frame was not confirmed. Document any missing speech manually before continuing; reconnect cannot recover it.',
      );
      return;
    }
    startingRef.current = true;
    const attempt = ++liveAttemptRef.current;
    attemptAbortRef.current?.abort();
    const abort = new AbortController();
    attemptAbortRef.current = abort;
    const isCurrentAttempt = () => !unmountedRef.current && liveAttemptRef.current === attempt;
    const previousSocket = wsRef.current;
    renewalRef.current?.dispose();
    renewalRef.current = null;
    wsRef.current = null;
    previousSocket?.close();
    audioDeliveryRef.current = 'off';
    pauseReplyRef.current?.reject(new Error('A new connection was requested.'));
    await streamRef.current.stop().catch(() => {});
    if (!isCurrentAttempt()) return;
    // Reconnect path: the browser still holds the transcript — keep it on
    // screen and replay it to the gateway (`resume`) so the consult continues
    // from the whole session, not just what it hears after the drop.
    const resume = shouldResumeRecovery(utterancesRef.current.length, opts.resume === true);
    setError(null);
    setNoteFailed(false);
    setConnectionLost(false);
    setConsentBlocked(null);
    setSaveFailed(null);
    setPauseWarning(null);
    if (!resume && !opts.resume) {
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
    phaseRef.current = 'connecting';
    startupAudioRef.current = [];
    startupAudioBytesRef.current = 0;

    if (window.location.protocol === 'https:' && GATEWAY_URL.startsWith('ws://')) {
      setPhase('error');
      setError(
        'The live scribe is not configured for secure connections. Record the batch way instead.',
      );
      startingRef.current = false;
      return;
    }

    let token: string;
    let initialLease: LiveTokenLease;
    try {
      const requestedAtMs = Date.now();
      const r = await fetch(`/api/v1/sessions/${sessionId}/live-token`, {
        method: 'POST',
        signal: AbortSignal.any([AbortSignal.timeout(20_000), abort.signal]),
      });
      if (!isCurrentAttempt()) return;
      if (r.ok) {
        const body = (await r.json()) as { token?: unknown; expiresInSec?: unknown };
        if (!isCurrentAttempt()) return;
        if (
          typeof body.token !== 'string' ||
          !body.token.length ||
          body.token.length > 8192 ||
          typeof body.expiresInSec !== 'number' ||
          !Number.isFinite(body.expiresInSec) ||
          body.expiresInSec <= 0 ||
          body.expiresInSec > 86_400 ||
          requestedAtMs + body.expiresInSec * 1000 <= Date.now()
        )
          throw new Error('Could not verify live authorization. Retry before recording.');
        token = body.token;
        initialLease = { requestedAtMs, expiresInSec: body.expiresInSec };
      } else if (r.status === 409) {
        // The one refusal the therapist can actually fix here: the client's
        // consents on record don't cover the live scribe (or were withdrawn).
        // Surface the server's real reason + the capture path, instead of
        // proceeding tokenless into the gateway's generic "unauthorized".
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        if (!isCurrentAttempt()) return;
        setPhase('error');
        setConsentBlocked(
          body.error ?? "The client's consents on record don't cover the live scribe.",
        );
        startingRef.current = false;
        return;
      } else {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          body.error ?? 'Could not authorize this session. Check your sign-in and try again.',
        );
      }
    } catch (reason) {
      if (!isCurrentAttempt()) return;
      startingRef.current = false;
      setPhase('error');
      setError((reason as Error).message);
      return;
    }

    if (!isCurrentAttempt()) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(GATEWAY_URL);
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
      startingRef.current = false;
      return;
    }
    wsRef.current = ws;
    const ownsSocket = () => isCurrentAttempt() && wsRef.current === ws;
    const assertOwnsSocket = () => {
      if (!ownsSocket()) throw new Error('Live capture start was cancelled.');
    };
    const renewal = new LiveTokenRenewal({
      sessionId,
      initialLease,
      send: (command) => {
        assertOwnsSocket();
        if (ws.readyState !== WebSocket.OPEN) throw new Error('Live connection closed.');
        ws.send(JSON.stringify(command));
      },
      onFailure: () => {
        if (!ownsSocket()) return;
        audioDeliveryRef.current = 'off';
        ++liveAttemptRef.current;
        abort.abort();
        wsRef.current = null;
        startingRef.current = false;
        pauseReplyRef.current?.reject(new Error('Live authorization could not be renewed.'));
        void streamRef.current.stop().catch(() => {});
        ws.close();
        if (phaseRef.current === 'paused') {
          setPauseWarning(
            'Microphone off. Live authorization could not be renewed. Resume explicitly to recheck access and consent. Captured transcript remains available.',
          );
        } else if (['pausing', 'pause-unconfirmed'].includes(phaseRef.current)) {
          phaseRef.current = 'pause-unconfirmed';
          setPhase('pause-unconfirmed');
          setPauseWarning(
            'Microphone off. Live authorization could not be renewed before pause was confirmed. Review captured words before continuing.',
          );
          setConnectionLost(true);
        } else {
          phaseRef.current = 'error';
          setPhase('error');
          setConnectionLost(true);
          setError(
            'Live authorization could not be renewed. Microphone stopped. Reconnect explicitly after checking access and consent, or recover the captured transcript below.',
          );
        }
      },
    });
    renewalRef.current = renewal;

    ws.onopen = () => {
      if (!ownsSocket()) return;
      void coordinateMindSessionStart(
        { clientId: clientId ?? '', sessionId, captureMode: 'LIVE' },
        {
          selectOrReuseSession: async () => {
            assertOwnsSocket();
            return {
              id: sessionId,
              status: lifecycleStartedRef.current ? 'IN_PROGRESS' : 'SCHEDULED',
            };
          },
          // Scheduled pages can reach this point only through the same-session
          // preflight; live-token above also verified the durable snapshot.
          resolveConsent: async () => ({ sessionId, snapshotRecorded: true }),
          runPreflight: async () => ({ ready: true }),
          activateCapture: async () => {
            try {
              assertOwnsSocket();
              audioDeliveryRef.current = 'buffering';
              await streamRef.current.start();
              assertOwnsSocket();
              return { active: true as const };
            } catch (reason) {
              return { active: false as const, reason: (reason as Error).message };
            }
          },
          authorizeCapture: async () => {
            assertOwnsSocket();
            const response = await fetch(`/api/v1/sessions/${sessionId}/start`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ captureMode: 'LIVE' }),
              signal: AbortSignal.any([AbortSignal.timeout(20_000), abort.signal]),
            });
            assertOwnsSocket();
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(body.error ?? `Could not mark capture active (${response.status}).`);
            }
            lifecycleStartedRef.current = true;
          },
        },
      )
        .then(() => {
          if (!ownsSocket()) return;
          startingRef.current = false;
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
          if (!ownsSocket()) return;
          startingRef.current = false;
          void streamRef.current.stop().catch(() => {});
          setError(
            `Could not start capture: ${(reason as Error).message}. Try again after resolving this issue.`,
          );
          setPhase('idle');
          ws.close();
        });
    };

    ws.onerror = () => {
      renewal.dispose();
      if (!ownsSocket()) return;
      audioDeliveryRef.current = 'off';
      pauseReplyRef.current?.reject(
        new Error('The live connection failed before pause was confirmed.'),
      );
      startingRef.current = false;
      void streamRef.current.stop().catch(() => {});
      // Mid-session an error event is always followed by close — the
      // recovery card (onclose) owns that path. Only a failed initial
      // connect reports the connect-time message.
      if (phaseRef.current !== 'connecting') return;
      setPhase('error');
      setError(
        'The live scribe could not connect. Check your connection, try again, or use Record only.',
      );
    };

    // AUD2 — a clean close (gateway restart/crash/deploy) previously left the
    // screen on "listening" forever while frames were silently dropped. If we
    // were mid-session and no final note arrived, stop the mic and surface a
    // recovery card (reconnect, or continue the classic recorded way).
    ws.onclose = () => {
      renewal.dispose();
      if (!ownsSocket()) return;
      audioDeliveryRef.current = 'off';
      pauseReplyRef.current?.reject(
        new Error('The live connection closed before pause was confirmed.'),
      );
      ++liveAttemptRef.current;
      abort.abort();
      wsRef.current = null;
      startingRef.current = false;
      void streamRef.current.stop().catch(() => {});
      if (finalHandledRef.current) return;
      const p = phaseRef.current;
      if (p === 'paused') {
        setPauseWarning(
          'Microphone off. The paused connection has expired or disconnected. Resume explicitly to recheck consent and continue from the confirmed transcript.',
        );
      } else if (p === 'pausing' || p === 'pause-unconfirmed') {
        phaseRef.current = 'pause-unconfirmed';
        setPhase('pause-unconfirmed');
        setPauseWarning(
          'Microphone off, connection lost. The last spoken words were not confirmed transcribed. Review captured words before continuing.',
        );
        setConnectionLost(true);
      } else if (p === 'listening' || p === 'finalizing') {
        setConnectionLost(true);
        setPhase('error');
      } else if (p === 'connecting') {
        setPhase('error');
        setError(
          'The live connection closed before capture could start. Try again or use Record only.',
        );
      }
    };

    ws.onmessage = (ev) => {
      if (!ownsSocket()) return;
      let raw: unknown;
      try {
        raw = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const parsed = LiveGatewayEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      renewal.handleEvent(event);
      if (!ownsSocket()) return;
      switch (event.type) {
        case 'status':
          if (event.state === 'listening' && phaseRef.current === 'connecting') {
            renewal.start();
            if (!ownsSocket()) return;
            for (const pcm of startupAudioRef.current) ws.send(pcm);
            startupAudioRef.current = [];
            startupAudioBytesRef.current = 0;
            audioDeliveryRef.current = 'sending';
            phaseRef.current = 'listening';
            setPhase('listening');
          } else if (event.state === 'finalizing') {
            renewal.dispose();
            if (['pausing', 'paused', 'pause-unconfirmed'].includes(phaseRef.current)) {
              setPauseWarning(
                'Microphone off. This gateway started closing while paused; it may need the pause-support update. No note will be saved automatically.',
              );
              break;
            }
            setPhase('finalizing');
            setFinalStage('generating-note');
          } else if (event.state === 'done') {
            renewal.dispose();
            if (['pausing', 'paused', 'pause-unconfirmed'].includes(phaseRef.current)) break;
            setPhase('done');
            // The gateway always sends `done` after a therapyFinal. If we get
            // here without one, no note was generated (Pass 2 empty/blocked) —
            // surface a recovery panel instead of hanging on "Finishing…".
            if (!finalHandledRef.current) setNoteFailed(true);
          } else if (event.state === 'unauthorized' || event.state === 'busy') {
            renewal.dispose();
            audioDeliveryRef.current = 'off';
            pauseReplyRef.current?.reject(
              new Error('The live connection is no longer authorized.'),
            );
            void streamRef.current.stop().catch(() => {});
            if (phaseRef.current === 'paused') {
              setPauseWarning(
                'Microphone off. Live authorization expired or changed. Resume explicitly to recheck access and consent.',
              );
              ws.close();
              break;
            }
            setPhase('error');
            setError(
              event.state === 'busy'
                ? 'The live scribe is at capacity — try again in a moment, or record the batch way.'
                : 'The live session could not be authorized.',
            );
          }
          break;
        case 'capturePaused':
          if (pauseReplyRef.current?.requestId === event.requestId) pauseReplyRef.current.resolve();
          break;
        case 'capturePauseFailed':
          if (pauseReplyRef.current?.requestId === event.requestId)
            pauseReplyRef.current.reject(
              new Error(
                'The gateway could not confirm the last audio. Retry confirming pause, or end and save.',
              ),
            );
          break;
        case 'utterance':
          utterancesRef.current = [...utterancesRef.current, event.utterance];
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
          renewal.dispose();
          if (['pausing', 'paused', 'pause-unconfirmed'].includes(phaseRef.current)) {
            finalPayloadRef.current = {
              kind: event.kind,
              note: event.note,
              transcript: event.transcript ?? buildTranscript(utterancesRef.current),
            };
            setSaveFailed(
              'The gateway finished while capture was paused. Review the captured transcript; use Retry save only if you intend to end this session.',
            );
            break;
          }
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
    if (
      !['listening', 'paused', 'pause-unconfirmed'].includes(phaseRef.current) ||
      captureIntegrityErrorRef.current
    )
      return;
    setEndConfirmOpen(true);
  }

  async function confirmEnd(): Promise<void> {
    if (
      !['listening', 'paused', 'pause-unconfirmed'].includes(phaseRef.current) ||
      captureIntegrityErrorRef.current
    )
      return;
    setEndConfirmOpen(false);
    setFinalStage('stopping');
    renewalRef.current?.dispose();
    renewalRef.current = null;
    setPhase('finalizing');
    phaseRef.current = 'finalizing';
    try {
      await stream.stop();
      audioDeliveryRef.current = 'off';
      if (wsRef.current?.readyState !== WebSocket.OPEN)
        throw new Error('The live connection closed. Recover the captured transcript below.');
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    } catch (reason) {
      setConnectionLost(true);
      setPhase('error');
      setError((reason as Error).message);
    }
  }

  async function pauseCapture(): Promise<void> {
    if (!['listening', 'pause-unconfirmed'].includes(phaseRef.current) || unmountedRef.current)
      return;
    const attempt = liveAttemptRef.current;
    const socket = wsRef.current;
    phaseRef.current = 'pausing';
    setPhase('pausing');
    setPauseWarning(null);
    try {
      try {
        await streamRef.current.stop();
      } catch {
        captureIntegrityErrorRef.current = true;
        throw new Error(
          'Microphone off, but the final audio frame was not confirmed. Known transcript words remain available; missing speech must be documented manually.',
        );
      }
      audioDeliveryRef.current = 'off';
      if (unmountedRef.current || liveAttemptRef.current !== attempt) return;
      if (!socket || socket.readyState !== WebSocket.OPEN)
        throw new Error(
          'The live connection is closed. The last audio was not confirmed transcribed.',
        );
      const requestId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            pauseReplyRef.current?.requestId === requestId &&
            pauseReplyRef.current.reject(
              new Error(
                'The gateway has not confirmed pause. It may be slow or need the pause-support update. Your microphone is off; the last spoken words are not yet confirmed transcribed.',
              ),
            ),
          30_000,
        );
        pauseReplyRef.current = {
          requestId,
          resolve: () => {
            clearTimeout(timer);
            pauseReplyRef.current = null;
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            pauseReplyRef.current = null;
            reject(error);
          },
        };
        socket.send(JSON.stringify({ type: 'pause', requestId }));
      });
      if (unmountedRef.current || liveAttemptRef.current !== attempt) return;
      phaseRef.current = 'paused';
      setPhase('paused');
    } catch (reason) {
      if (unmountedRef.current || liveAttemptRef.current !== attempt) return;
      audioDeliveryRef.current = 'off';
      phaseRef.current = 'pause-unconfirmed';
      setPhase('pause-unconfirmed');
      setPauseWarning((reason as Error).message);
    }
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
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {phase === 'idle' && (
            <Button onClick={() => void start({ resume: utterances.length > 0 })}>
              Start session
            </Button>
          )}
          {phase === 'connecting' && (
            <span role="status" className="text-sm">
              Connecting capture…
            </span>
          )}
          {phase === 'listening' && (
            <span className="flex items-center gap-2 text-sm tabular-nums text-[var(--color-ink-2)]">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              {mm}:{ss}
            </span>
          )}
          {phase === 'listening' && (
            <Button variant="secondary" onClick={() => void pauseCapture()}>
              Pause recording
            </Button>
          )}
          {phase === 'paused' && (
            <Button onClick={() => void start({ resume: true })}>Resume recording</Button>
          )}
          {['listening', 'paused', 'pause-unconfirmed'].includes(phase) && (
            <Button variant="secondary" onClick={end} disabled={captureIntegrityErrorRef.current}>
              End session
            </Button>
          )}
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

      {['pausing', 'paused', 'pause-unconfirmed'].includes(phase) && (
        <Card
          className="border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm"
          role="status"
        >
          <p className="font-medium">
            Microphone off ·{' '}
            {phase === 'pausing'
              ? 'confirming the last audio…'
              : phase === 'paused'
                ? 'recording paused'
                : 'pause not confirmed'}
          </p>
          <p className="mt-1">
            No new audio is being captured.{' '}
            {phase === 'paused'
              ? 'The gateway confirmed the audio before this pause was processed. This session has not ended; keep this page open and choose Resume when ready.'
              : 'Keep this page open until the last captured audio is confirmed. Do not continue speaking for the record yet.'}
          </p>
          {pauseWarning && <p className="mt-2 text-[var(--color-warn)]">{pauseWarning}</p>}
          {phase === 'pause-unconfirmed' &&
            !captureIntegrityErrorRef.current &&
            wsRef.current?.readyState === WebSocket.OPEN && (
              <Button className="mt-3" variant="secondary" onClick={() => void pauseCapture()}>
                Retry pause confirmation
              </Button>
            )}
        </Card>
      )}

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
              Capture will stop, the final note will be generated, then both will be saved. Keep
              this page open until saving finishes.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEndConfirmOpen(false)}>
                {phase === 'paused' || phase === 'pause-unconfirmed'
                  ? 'Stay paused'
                  : 'Keep recording'}
              </Button>
              <Button onClick={confirmEnd}>End &amp; save</Button>
            </div>
          </Card>
        </div>
      )}

      {finalStage === 'generating-note' && !saveFailed && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>
            {durableRef.current
              ? 'Transcript saved securely. Note generation is running.'
              : 'Finishing the note. Keep this page open: saving is not yet confirmed.'}
          </span>
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
                <Button variant="secondary" onClick={continueAsBatch} disabled={saving}>
                  Record the classic way
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => navigateAway(`/app/sessions/${sessionId}`)}
              >
                Open session
              </Button>
            </div>
          )}
        </Card>
      )}
      {localRecoveryFailed && (
        <Card className="border-amber-300 p-4 text-sm">
          Browser recovery storage is unavailable. Keep this tab open until the server confirms
          saving, or save a transcript copy.
        </Card>
      )}

      {consentBlocked && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">Consent is missing for the live scribe.</strong>
          <p className="mt-1">{consentBlocked}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {clientId && (
              <Button onClick={() => navigateAway(`/app?record=${clientId}`)}>
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
            {saveFailed} The generated note and received transcript are still held in this tab. Keep
            it open and retry saving. A transcript download preserves only the displayed words, not
            the original audio or any untranscribed speech.
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
            <Button variant="secondary" onClick={() => navigateAway('/app/today')}>
              Return to Today
            </Button>
          </div>
        </Card>
      )}

      {(connectionLost || captureIntegrityErrorRef.current) && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">
            {captureIntegrityErrorRef.current
              ? 'The final audio frame could not be confirmed.'
              : 'The live connection dropped.'}
          </strong>
          <p className="mt-1">
            Capture has stopped. Reconnect replays the words already shown here. Switching to
            recording first saves those words securely, then continues the same session. Audio not
            yet transcribed cannot be recovered by these actions; check the last captured words and
            repeat or document anything missing.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!captureIntegrityErrorRef.current && (
              <Button onClick={() => void start({ resume: true })}>Reconnect</Button>
            )}
            {clientId && (
              <Button variant="secondary" onClick={continueAsBatch} disabled={saving}>
                Continue as recording (transcript preserved)
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void recoverTranscript('FINALIZE')}
              disabled={saving || !utterances.length}
            >
              Generate from captured transcript
            </Button>
            {captureIntegrityErrorRef.current && (
              <Button variant="secondary" onClick={downloadHeldTranscript}>
                Save transcript
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigateAway(`/app/sessions/${sessionId}`)}>
              Open session
            </Button>
          </div>
        </Card>
      )}

      {noteFailed && (
        <Card className="border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <strong className="block">The note couldn’t be generated automatically.</strong>
          <p className="mt-1">
            The AI note did not come back. Generate again using only the words already shown here,
            without reopening the microphone. Check for missing speech before relying on the draft;
            audio that was never transcribed is not included.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => void recoverTranscript('FINALIZE')}
              disabled={saving || !utterances.length}
            >
              {saving ? 'Saving & generating…' : 'Generate from captured transcript'}
            </Button>
            <Button variant="secondary" onClick={downloadHeldTranscript}>
              Save transcript
            </Button>
            <Button variant="secondary" onClick={() => navigateAway('/app/today')}>
              Return to Today
            </Button>
            <Button variant="secondary" onClick={() => navigateAway(`/app/sessions/${sessionId}`)}>
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
          guideActive={hasGuide}
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
                reviewTarget={
                  clientId
                    ? {
                        clientId,
                        scriptId: selectedGuide.id,
                        scriptUpdatedAt: selectedGuide.updatedAt,
                      }
                    : undefined
                }
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
              <p className="text-sm text-[var(--color-ink-3)]">
                Use Start session at the top when you are ready.
              </p>
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
