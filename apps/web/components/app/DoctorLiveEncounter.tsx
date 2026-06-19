'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LiveGatewayEventSchema,
  type EncounterGap,
  type LiveTranscriptDelta,
  type MedicalEncounterNoteV1,
  type PartialStructuredNote,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { MedicalNoteView } from './MedicalNoteView';

/**
 * Sprint DV4 — the live copilot (preview). Connects to the standalone
 * WebSocket gateway and renders the three rails as they stream:
 *   Rail 1 — live transcript
 *   Rail 2 — the note building itself
 *   Rail 3 — gaps + red flags surfaced mid-consult
 * Mock-first: the gateway replays a scripted consult (no audio/ASR yet),
 * so the whole UX runs locally. See services/live-gateway.
 */
const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

export function DoctorLiveEncounter() {
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState<LiveTranscriptDelta[]>([]);
  const [note, setNote] = useState<PartialStructuredNote>({});
  const [gaps, setGaps] = useState<EncounterGap[]>([]);
  const [finalNote, setFinalNote] = useState<MedicalEncounterNoteV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => wsRef.current?.close(), []);

  function start(): void {
    setError(null);
    setTranscript([]);
    setNote({});
    setGaps([]);
    setFinalNote(null);
    setPhase('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(GATEWAY_URL);
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'start' }));
    ws.onerror = () => {
      setPhase('error');
      setError(
        `Couldn't reach the live gateway at ${GATEWAY_URL}. Start it with: pnpm --filter @cureocity/live-gateway dev`,
      );
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };
    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data as string);
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
          else if (event.state === 'done') setPhase('done');
          break;
        case 'transcript':
          setTranscript((prev) => [...prev, event.delta]);
          break;
        case 'note':
          setNote(event.partial);
          break;
        case 'gap':
          setGaps((prev) => [...prev, event.gap]);
          break;
        case 'final':
          setFinalNote(event.note);
          break;
      }
    };
  }

  function stop(): void {
    wsRef.current?.send(JSON.stringify({ type: 'stop' }));
  }

  const live = phase === 'listening' || phase === 'finalizing';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PhaseBadge phase={phase} />
          <p className="text-xs text-[var(--color-ink-3)]">
            Preview · mock gateway. No audio is recorded.
          </p>
        </div>
        <div className="flex gap-2">
          {finalNote || phase === 'done' ? (
            <Button onClick={start} variant="secondary">
              Run again
            </Button>
          ) : live ? (
            <Button onClick={stop} className="bg-[var(--color-warn)] hover:bg-[#a25b30]">
              End consult
            </Button>
          ) : (
            <Button onClick={start} disabled={phase === 'connecting'}>
              {phase === 'connecting' ? 'Connecting…' : 'Start live consult'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-5 text-sm text-[var(--color-warn)]">
          {error}
        </Card>
      )}

      {finalNote ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-ink-2)]">
            Consult ended — here is the finished note (≈90% drafted before you touched a key):
          </p>
          <Card className="p-7">
            <MedicalNoteView note={finalNote} />
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.1fr_0.9fr]">
          <Rail title="Transcript">
            {transcript.length === 0 ? (
              <Empty>Press “Start live consult”.</Empty>
            ) : (
              <ul className="space-y-2">
                {transcript.map((d, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                      {d.speaker}
                    </span>
                    <span className="text-[var(--color-ink)]">{d.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Rail>

          <Rail title="Note · building">
            {isEmptyNote(note) ? (
              <Empty>The note fills in as the consult goes.</Empty>
            ) : (
              <dl className="space-y-3 text-sm">
                <NoteField label="Chief complaint" value={note.chiefComplaint} />
                <NoteField label="HPI" value={note.hpi} />
                <NoteField label="Vitals" value={formatVitals(note.vitals)} />
                <NoteField label="Assessment" value={note.assessment} />
                <NoteField label="Plan" value={note.plan} />
              </dl>
            )}
          </Rail>

          <Rail title="Ask & flag">
            {gaps.length === 0 ? (
              <Empty>Missed questions + red flags appear here.</Empty>
            ) : (
              <ul className="space-y-2">
                {gaps.map((g, i) => (
                  <li key={i} className={`rounded-xl border p-3 text-sm ${gapTone(g.severity)}`}>
                    <span className="mr-1">{gapIcon(g.kind)}</span>
                    {g.message}
                  </li>
                ))}
              </ul>
            )}
          </Rail>
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; tone: 'accent' | 'muted' | 'warn' }> = {
    idle: { label: 'Ready', tone: 'muted' },
    connecting: { label: 'Connecting', tone: 'muted' },
    listening: { label: '● Listening', tone: 'accent' },
    finalizing: { label: 'Finalising', tone: 'accent' },
    done: { label: 'Done', tone: 'accent' },
    error: { label: 'Gateway offline', tone: 'warn' },
  };
  const m = map[phase];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function Rail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function NoteField({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--color-ink-3)]">{children}</p>;
}

function isEmptyNote(note: PartialStructuredNote): boolean {
  return !note.chiefComplaint && !note.hpi && !note.assessment && !note.plan && !note.vitals;
}

function formatVitals(v: PartialStructuredNote['vitals']): string | undefined {
  if (!v) return undefined;
  const parts = [
    v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
    v.heartRateBpm ? `HR ${v.heartRateBpm}` : null,
    v.spo2Pct ? `SpO₂ ${v.spo2Pct}%` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('  ·  ') : undefined;
}

function gapTone(severity: EncounterGap['severity']): string {
  if (severity === 'critical')
    return 'border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]';
  if (severity === 'warn')
    return 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]';
  return 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)]';
}

function gapIcon(kind: EncounterGap['kind']): string {
  switch (kind) {
    case 'RED_FLAG':
      return '🔴';
    case 'DRUG_INTERACTION':
      return '💊';
    case 'CODING':
      return '🧾';
    default:
      return '❓';
  }
}
