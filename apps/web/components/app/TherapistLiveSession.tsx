'use client';

/**
 * Sprint TS2 — the therapist live scribe surface.
 *
 * The therapist analogue of DoctorLiveEncounter: streams mic audio to the
 * standalone live gateway (which runs Pass 1 + the therapy Pass 2) and renders
 * the transcript + a live-building SOAP/intake note + a safety rail (the note's
 * own riskFlags) as the therapist talks — no more blind, timer-only recording.
 *
 * On end it relays the finalized note to the live-note route (persisted as a
 * COMPLETED NoteDraft) and routes to the session workspace, where the existing
 * therapist review / sign / share surface takes over with the note ALREADY
 * written (no post-hoc generation wait). TS3 will inline that review surface
 * here; this MVP reuses the proven one.
 *
 * NOTE: like DoctorLiveEncounter, this is a browser-only WS/audio surface — it
 * cannot be exercised in CI. Drive it once with `pnpm gateway` before trusting.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LiveGatewayEventSchema,
  type IntakeNoteV1,
  type MeterSummary,
  type SessionKind,
  type SessionModality,
  type TherapyNoteV1,
  type Utterance,
} from '@cureocity/contracts';
import { useLiveStream } from '@/lib/audio/use-live-stream';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

interface Props {
  sessionId: string;
  kind: SessionKind;
  modality: SessionModality | null;
  clientName?: string;
  /** Auto-start the mic once (arriving via a flash/queue flow). */
  autoStart?: boolean;
}

/** The note fields we render, in order, per kind — defensive to missing keys. */
function noteSections(
  kind: SessionKind,
  note: Record<string, unknown>,
): { label: string; value: string }[] {
  const rows: [string, string][] =
    kind === 'INTAKE'
      ? [
          ['Presenting concerns', 'presentingConcerns'],
          ['History of present illness', 'historyOfPresentingIllness'],
          ['Past psychiatric history', 'pastPsychiatricHistory'],
          ['Family history', 'familyHistory'],
          ['Social history', 'socialHistory'],
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
  return rows
    .map(([label, key]) => ({
      label,
      value: typeof note[key] === 'string' ? (note[key] as string) : '',
    }))
    .filter((r) => r.value.trim().length > 0);
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

export function TherapistLiveSession({ sessionId, kind, modality, clientName, autoStart }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [note, setNote] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  // Set when the consult ended but no note ever arrived (Pass 2 empty/blocked
  // upstream). Terminal, recoverable — never leave the user on "Finishing…".
  const [noteFailed, setNoteFailed] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const meterRef = useRef<MeterSummary | null>(null);
  const meteredRef = useRef(false);
  const finalHandledRef = useRef(false);

  const stream = useLiveStream({
    onFrame: (pcm) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) ws.send(pcm);
    },
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      void streamRef.current.stop();
    };
  }, []);

  // Elapsed timer while listening.
  useEffect(() => {
    if (phase !== 'listening') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !autoStartedRef.current && phase === 'idle') {
      autoStartedRef.current = true;
      void start();
    }
  }, [autoStart, phase]);

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
    setUtterances([]);
    setNote({});
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
        }),
      );
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
          break;
        case 'meter':
          meterRef.current = event.summary;
          break;
        case 'therapyFinal':
          setNote(event.note as unknown as Record<string, unknown>);
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

  const risk = readRisk(note);
  const sections = noteSections(kind, note);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">{clientName || 'Live session'}</h1>
          <p className="text-sm text-[var(--color-ink-3)]">
            {kind === 'INTAKE' ? 'Intake' : kind === 'REVIEW' ? 'Review' : 'Session'}
            {modality ? ` · ${modality}` : ''} · live scribe
          </p>
        </div>
        <div className="flex items-center gap-3">
          {phase === 'listening' && (
            <span className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]">
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

      {risk && (
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
      )}

      {phase === 'idle' && (
        <Card className="p-8 text-center">
          <p className="mb-4 text-sm text-[var(--color-ink-2)]">
            The transcript and note build in real time as you talk.
          </p>
          <Button onClick={() => void start()}>Start session</Button>
        </Card>
      )}

      {phase !== 'idle' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
              Transcript
            </h2>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
              {utterances.length === 0 ? (
                <p className="text-[var(--color-ink-3)]">Listening…</p>
              ) : (
                [...utterances]
                  .sort((a, b) => a.tStartMs - b.tStartMs)
                  .map((u) => (
                    <p key={u.id}>
                      <span className="font-medium text-[var(--color-ink-3)]">
                        {u.speaker === 'doctor' ? 'You' : u.speaker === 'patient' ? 'Client' : '—'}
                        :{' '}
                      </span>
                      {u.text}
                    </p>
                  ))
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
              Note{' '}
              {phase === 'listening' && (
                <span className="text-[var(--color-ink-3)]">· writing…</span>
              )}
            </h2>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
              {sections.length === 0 ? (
                <p className="text-[var(--color-ink-3)]">
                  The note appears here as the session unfolds.
                </p>
              ) : (
                sections.map((s) => (
                  <div key={s.label}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                      {s.label}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-[var(--color-ink)]">{s.value}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
