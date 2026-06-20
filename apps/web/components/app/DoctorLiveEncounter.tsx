'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChronicTrajectorySchema,
  LiveGatewayEventSchema,
  type EncounterGap,
  type MedicalEncounterNoteV1,
  type PartialStructuredNote,
  type VoiceCommand,
} from '@cureocity/contracts';
import { useLiveStream } from '@/lib/audio/use-live-stream';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { MedicalNoteView } from './MedicalNoteView';

/**
 * Sprint DV4 (full) — the live copilot. Streams real mic audio to the
 * standalone WebSocket gateway and renders the three rails as the
 * gateway runs the real pipeline:
 *   Rail 1 — live transcript (Pass 1 on the rolling buffer)
 *   Rail 2 — the note building itself (Pass 2, vertical=DOCTOR)
 *   Rail 3 — gaps + red flags surfaced mid-consult (gap engine)
 * LLM_BACKEND=mock makes it run locally; vertex makes it fully real.
 * See services/live-gateway + docs/DOCTOR_VERTICAL.md §4.
 */
const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

export function DoctorLiveEncounter({
  sessionId,
  clientId,
  specialty,
}: {
  sessionId: string;
  clientId?: string;
  specialty?: string | null;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [note, setNote] = useState<PartialStructuredNote>({});
  const [gaps, setGaps] = useState<EncounterGap[]>([]);
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [shownData, setShownData] = useState<Record<string, string>>({});
  const [finalNote, setFinalNote] = useState<MedicalEncounterNoteV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve a SHOW_DATA command against the patient's chronic readings.
  async function resolveShowData(measure: string): Promise<void> {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/chronic`);
      if (!res.ok) return;
      const parsed = ChronicTrajectorySchema.safeParse(await res.json());
      if (!parsed.success) return;
      const m = parsed.data.measures.find((x) => x.measure === measure);
      setShownData((prev) => ({
        ...prev,
        [measure]: m?.latest ? `${m.latest.display} ${m.unit}` : 'no readings on file',
      }));
    } catch {
      /* best-effort */
    }
  }

  const stream = useLiveStream({
    onFrame: (pcm) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) ws.send(pcm);
    },
  });

  // Close the socket + release the mic on unmount. `stream` is a stable
  // hook handle; we intentionally run this once.
  const streamRef = useRef(stream);
  streamRef.current = stream;
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      void streamRef.current.stop();
    };
  }, []);

  async function start(): Promise<void> {
    setError(null);
    setTranscript('');
    setNote({});
    setGaps([]);
    setCommands([]);
    setShownData({});
    setFinalNote(null);
    setPhase('connecting');

    // Sprint DV8 hardening — mint a short-lived token so the gateway can
    // verify we own this session. In dev the gateway runs open, so a
    // failed mint is non-fatal.
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
          ...(specialty ? { specialty } : {}),
          ...(token ? { token } : {}),
        }),
      );
      void stream.start().catch((e: Error) => {
        setError(`Microphone unavailable: ${e.message}`);
        setPhase('error');
        ws.close();
      });
    };
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
          else if (event.state === 'unauthorized') {
            setPhase('error');
            setError('The live session could not be authorised. Reload the page and try again.');
          }
          break;
        case 'transcript':
          setTranscript((prev) => (prev ? `${prev} ${event.delta.text}` : event.delta.text));
          break;
        case 'note':
          setNote(event.partial);
          break;
        case 'gap':
          setGaps((prev) => [...prev, event.gap]);
          break;
        case 'command':
          setCommands((prev) =>
            prev.some((c) => c.raw === event.command.raw) ? prev : [...prev, event.command],
          );
          if (event.command.kind === 'SHOW_DATA') void resolveShowData(event.command.measure);
          break;
        case 'final':
          setFinalNote(event.note);
          break;
      }
    };
  }

  function stop(): void {
    void stream.stop();
    wsRef.current?.send(JSON.stringify({ type: 'stop' }));
  }

  const live = phase === 'listening' || phase === 'finalizing';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PhaseBadge phase={phase} />
          <p className="text-xs text-[var(--color-ink-3)]">
            {live
              ? 'Listening — your mic is streaming to the in-region gateway.'
              : 'The note writes itself while you consult. Mic audio is streamed live, not stored.'}
          </p>
        </div>
        <div className="flex gap-2">
          {finalNote || phase === 'done' ? (
            <Button onClick={() => void start()} variant="secondary">
              New consult
            </Button>
          ) : live ? (
            <Button onClick={stop} className="bg-[var(--color-warn)] hover:bg-[#a25b30]">
              End consult
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={phase === 'connecting'}>
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
        <>
          {commands.length > 0 && (
            <Card className="mb-4 border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Copilot heard
              </h2>
              <ul className="space-y-1.5">
                {commands.map((c, i) => (
                  <li key={i} className="text-sm text-[var(--color-ink)]">
                    {commandLabel(c, shownData)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-ink-3)]">
                Recognised from your speech — confirm them on the note / orders before signing.
              </p>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1.1fr_0.9fr]">
            <Rail title="Transcript">
              {transcript.length === 0 ? (
                <Empty>Press “Start live consult” and allow the mic.</Empty>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
                  {transcript}
                </p>
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
        </>
      )}
    </div>
  );
}

function commandLabel(c: VoiceCommand, shownData: Record<string, string>): string {
  if (c.kind === 'ADD_MEDICATION') {
    const parts = [
      c.drug,
      c.strength,
      c.frequency,
      c.durationDays ? `${c.durationDays} days` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return `➕ Add to Rx: ${parts}`;
  }
  if (c.kind === 'ORDER_TEST') {
    return `🔬 Order: ${c.description}`;
  }
  const resolved = shownData[c.measure];
  return `📈 ${c.measure}${resolved ? `: ${resolved}` : ' — fetching…'}`;
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
