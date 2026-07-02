'use client';

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  ChronicTrajectorySchema,
  LiveGatewayEventSchema,
  type ClinicalFinding,
  type EncounterGap,
  type LiveReasoning,
  type MedicalEncounterNoteV1,
  type MeterSummary,
  type PartialStructuredNote,
  type RxPadDraft,
  type RxPadV1,
  type Utterance,
  type VoiceCommand,
} from '@cureocity/contracts';
import { useLiveStream } from '@/lib/audio/use-live-stream';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { MedicalNoteView } from './MedicalNoteView';

/**
 * Sprint DV4 (full) — the live copilot. Streams real mic audio to the
 * standalone WebSocket gateway and renders three surfaces as the gateway
 * runs the real pipeline:
 *   • Live transcript      (Pass 1 on the rolling buffer, diarized)
 *   • The note, writing itself (Pass 2, vertical=DOCTOR)
 *   • Live Copilot         — red flags, drug interactions, coding nudges,
 *                            missing-question prompts + heard voice commands,
 *                            ranked by urgency, updating as you talk.
 * The Copilot rail is the differentiator: decision support DURING the
 * consult, not just a note after. LLM_BACKEND=mock runs it locally; vertex
 * makes it fully real. See services/live-gateway + docs/DOCTOR_VERTICAL.md §4.
 */
const GATEWAY_URL = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';

type Phase = 'idle' | 'connecting' | 'listening' | 'finalizing' | 'done' | 'error';

export function DoctorLiveEncounter({
  sessionId,
  clientId,
  specialty,
  patient,
}: {
  sessionId: string;
  clientId?: string;
  specialty?: string | null;
  patient?: { name?: string | null; age?: number | null } | null;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  // Sprint DS0 — the gateway meters the consult and emits `meter` events;
  // we keep the latest and relay it once the consult is done.
  const latestMeterRef = useRef<MeterSummary | null>(null);
  const meteredRef = useRef(false);
  // Sprint DS3 — suggestion ids we've already audited as SHOWN, so each fires once.
  const shownSuggestionsRef = useRef<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('idle');
  // Sprint DS4 — the transcript is utterance-anchored (ids from DS0) so an
  // evidence chip can scroll-highlight its source utterance.
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const transcriptRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [note, setNote] = useState<PartialStructuredNote>({});
  const [findings, setFindings] = useState<ClinicalFinding[]>([]);
  const [reasoning, setReasoning] = useState<LiveReasoning | null>(null);
  // Sprint DS4 — differential candidates the doctor added to the assessment.
  const [assessmentAdds, setAssessmentAdds] = useState<string[]>([]);
  const assessmentRef = useRef<string[]>([]);
  // Sprint DS5 — the Rx pad assembling live + the doctor's per-med confirms.
  const [rxPad, setRxPad] = useState<RxPadDraft | null>(null);
  const [confirmedDrugs, setConfirmedDrugs] = useState<Set<string>>(new Set());
  const rxFinalRef = useRef<RxPadV1 | null>(null);
  const confirmedRef = useRef<Set<string>>(new Set());
  const [gaps, setGaps] = useState<EncounterGap[]>([]);
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [shownData, setShownData] = useState<Record<string, string>>({});
  const [finalNote, setFinalNote] = useState<MedicalEncounterNoteV1 | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const live = phase === 'listening' || phase === 'finalizing';

  // Consult timer — ticks only while the mic is streaming.
  useEffect(() => {
    if (phase !== 'listening') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Sprint DS4 — scroll the first highlighted utterance into view; auto-clear
  // the highlight after a moment so the pane returns to normal.
  useEffect(() => {
    if (highlightIds.size === 0) return;
    const firstId = [...highlightIds][0];
    if (firstId)
      transcriptRefs.current.get(firstId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightIds(new Set()), 2600);
    return () => clearTimeout(t);
  }, [highlightIds]);

  // Sprint DS4 — the trust feature: tap an evidence chip → highlight the
  // finding's source utterance(s) in the transcript pane.
  function highlightEvidence(findingIds: string[]): void {
    const uids = new Set<string>();
    for (const fid of findingIds) {
      const f = findings.find((x) => x.id === fid);
      f?.utteranceIds.forEach((u) => uids.add(u));
    }
    if (uids.size > 0) setHighlightIds(uids);
  }

  // Sprint DS4 — add a differential candidate to the note's assessment
  // (confirm-first in the UI). Persisted when the note lands + audited.
  function addToAssessment(dxId: string, label: string): void {
    const text = label.replace(/^\s*\[mock\]\s*/i, '').trim();
    setAssessmentAdds((prev) => {
      const next = prev.includes(text) ? prev : [...prev, text];
      assessmentRef.current = next;
      return next;
    });
    void relaySuggestion('acted', dxId, 'DIFFERENTIAL', label);
  }

  // Sprint DS5 — confirm a pending Rx row (confirm-first). The overlay
  // survives the gateway's idempotent re-emits + is audited.
  function confirmMed(drug: string): void {
    const key =
      drug
        .replace(/^\s*\[mock\]\s*/i, '')
        .toLowerCase()
        .split(/\s+/)[0] ?? drug;
    setConfirmedDrugs((prev) => {
      const next = new Set(prev).add(key);
      confirmedRef.current = next;
      return next;
    });
    void relaySuggestion('acted', `rx:${key}`, 'GAP', `Confirm Rx: ${drug}`);
  }

  // Sprint DV9 — persist the finalized live note as a draft the doctor can
  // sign from the encounter workspace (parity with the batch path).
  async function persistLiveNote(
    note: MedicalEncounterNoteV1,
    medications: unknown[],
    orders: unknown[],
    rx: RxPadV1 | null,
  ): Promise<void> {
    setSaveState('saving');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/live-note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note, medications, orders, ...(rx ? { rxPad: rx } : {}) }),
      });
      setSaveState(res.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  }

  // Sprint DS0 — relay the gateway's per-consult meter so it lands as a
  // LiveConsultMetric row (the gateway itself can't touch the DB). Fired
  // once, when the consult is done. Best-effort — never blocks the doctor.
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

  // Sprint DS3 — relay a live copilot suggestion lifecycle event so it lands
  // one audit row (the gateway can't touch the DB). Best-effort.
  async function relaySuggestion(
    event: 'shown' | 'acted' | 'dismissed' | 'autoresolved',
    suggestionId: string,
    kind: 'DIFFERENTIAL' | 'ASK_NEXT' | 'RED_FLAG' | 'GAP',
    label?: string,
  ): Promise<void> {
    try {
      await fetch(`/api/v1/sessions/${sessionId}/live-suggestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, suggestionId, kind, ...(label ? { label } : {}) }),
      });
    } catch {
      /* audit is best-effort */
    }
  }

  // Sprint DS3 — the doctor dismissed an ask-next question: tell the gateway
  // (so it never re-suggests) + audit it.
  function dismissQuestion(id: string, label?: string): void {
    wsRef.current?.send(JSON.stringify({ type: 'dismiss', questionId: id }));
    void relaySuggestion('dismissed', id, 'ASK_NEXT', label);
  }

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

  // Close the socket + release the mic on unmount. `stream` is a stable hook
  // handle; we intentionally run this once.
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
    setUtterances([]);
    setHighlightIds(new Set());
    transcriptRefs.current = new Map();
    setNote({});
    setFindings([]);
    setReasoning(null);
    setAssessmentAdds([]);
    assessmentRef.current = [];
    setRxPad(null);
    setConfirmedDrugs(new Set());
    confirmedRef.current = new Set();
    rxFinalRef.current = null;
    setGaps([]);
    setCommands([]);
    setShownData({});
    setFinalNote(null);
    setSaveState('idle');
    setElapsed(0);
    latestMeterRef.current = null;
    meteredRef.current = false;
    shownSuggestionsRef.current = new Set();
    setPhase('connecting');

    // Sprint DV8 hardening — mint a short-lived token so the gateway can
    // verify we own this session. In dev the gateway runs open, so a failed
    // mint is non-fatal.
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
          // Sprint DS1 — seed the CaseState with what the page knows about
          // the patient. Thin for now (age); richer context lands later.
          ...(patient?.age != null ? { context: { age: patient.age } } : {}),
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
          else if (event.state === 'done') {
            setPhase('done');
            // The final meter arrives just before `done`; relay it now.
            if (latestMeterRef.current) void persistMeter(latestMeterRef.current);
          } else if (event.state === 'unauthorized') {
            setPhase('error');
            setError('The live session could not be authorised. Reload the page and try again.');
          }
          break;
        case 'transcript':
          // Sprint DS4 — the utterance-anchored record (below) drives the
          // transcript display now; the delta is redundant.
          break;
        case 'utterance':
          setUtterances((prev) =>
            prev.some((u) => u.id === event.utterance.id) ? prev : [...prev, event.utterance],
          );
          break;
        case 'meter':
          latestMeterRef.current = event.summary;
          break;
        case 'finding':
          // Sprint DS1 — the current findings snapshot (idempotent). DS2/DS4
          // build the differential + evidence UI on top of these.
          setFindings(event.findings);
          break;
        case 'reasoning': {
          // Sprint DS2 — the live differential + ask-next snapshot (idempotent).
          // DS4 turns this into the persistent clinical-picture panel.
          setReasoning(event.reasoning);
          // Sprint DS3 — audit each suggestion SHOWN once; audit auto-resolves.
          const seen = shownSuggestionsRef.current;
          for (const d of event.reasoning.differential) {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              void relaySuggestion('shown', d.id, 'DIFFERENTIAL', d.label);
            }
          }
          for (const q of event.reasoning.askNext) {
            if (q.status === 'answered') {
              void relaySuggestion('autoresolved', q.id, 'ASK_NEXT', q.question);
            } else if (!seen.has(q.id)) {
              seen.add(q.id);
              void relaySuggestion('shown', q.id, 'ASK_NEXT', q.question);
            }
          }
          break;
        }
        case 'rxDraft':
          // Sprint DS5 — the Rx pad assembling live (idempotent snapshot).
          setRxPad(event.rxPad);
          break;
        case 'note':
          setNote(event.partial);
          break;
        case 'gap':
          setGaps((prev) =>
            prev.some((g) => g.message === event.gap.message) ? prev : [...prev, event.gap],
          );
          break;
        case 'command':
          setCommands((prev) =>
            prev.some((c) => c.raw === event.command.raw) ? prev : [...prev, event.command],
          );
          if (event.command.kind === 'SHOW_DATA') void resolveShowData(event.command.measure);
          break;
        case 'final': {
          // Sprint DS4 — fold the doctor's "add to assessment" picks into the
          // note before it persists (read from a ref — this closure is stale).
          const adds = assessmentRef.current;
          const merged =
            adds.length > 0
              ? {
                  ...event.note,
                  assessment: [event.note.assessment, ...adds.map((a) => `• ${a}`)]
                    .filter(Boolean)
                    .join('\n'),
                }
              : event.note;
          setFinalNote(merged);
          // Sprint DS5 — fold the doctor's confirms into the final Rx pad.
          const finalRx = event.rxPad ? confirmRxPad(event.rxPad, confirmedRef.current) : null;
          if (finalRx) setRxPad(finalRx);
          rxFinalRef.current = finalRx;
          void persistLiveNote(merged, event.medications, event.orders, finalRx);
          break;
        }
      }
    };
  }

  function stop(): void {
    void stream.stop();
    wsRef.current?.send(JSON.stringify({ type: 'stop' }));
  }

  const recs = rankRecommendations(gaps, commands, shownData);
  const criticalOpen = recs.some((r) => r.severity === 'critical');

  return (
    <div className="space-y-4">
      {/* Capture bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-white px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 place-items-center rounded-full bg-[#22331f] text-sm font-semibold text-white"
          >
            {initials(patient?.name)}
          </span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">
              {patient?.name || 'Patient'}
              {patient?.age != null && (
                <span className="font-normal text-[var(--color-ink-2)]"> · {patient.age}</span>
              )}
            </p>
            <p className="text-xs text-[var(--color-ink-3)]">
              {specialty ? `${specialty} · ` : ''}Live encounter
            </p>
          </div>
        </div>

        {live && (
          <div
            className={`ml-1 flex items-center gap-3 rounded-full px-3.5 py-1.5 ${
              phase === 'finalizing'
                ? 'bg-[var(--color-accent-soft)]'
                : 'bg-[var(--color-warn-soft)]'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                phase === 'finalizing'
                  ? 'bg-[var(--color-accent)]'
                  : 'bg-[var(--color-warn)] animate-pulse'
              }`}
            />
            <span
              className={`text-[13px] font-semibold tracking-wide ${
                phase === 'finalizing' ? 'text-[var(--color-accent)]' : 'text-[var(--color-warn)]'
              }`}
            >
              {phase === 'finalizing' ? 'Finishing…' : `REC ${fmtTime(elapsed)}`}
            </span>
            {phase === 'listening' && <Waveform />}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {finalNote || phase === 'done' ? (
            <Button onClick={() => void start()} variant="secondary">
              New consult
            </Button>
          ) : live ? (
            <Button onClick={stop} className="bg-[var(--color-warn)] hover:bg-[#a25b30]">
              End &amp; review note
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={phase === 'connecting'}>
              {phase === 'connecting' ? 'Connecting…' : '● Start live consult'}
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
        <FinalNote
          note={finalNote}
          saveState={saveState}
          clientId={clientId}
          sessionId={sessionId}
        />
      ) : phase === 'idle' || phase === 'connecting' ? (
        <StartPanel connecting={phase === 'connecting'} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,420px)]">
          <TranscriptPanel
            utterances={utterances}
            highlightIds={highlightIds}
            refs={transcriptRefs}
            listening={phase === 'listening'}
          />
          <div className="space-y-4">
            <RxPadPanel
              rxPad={rxPad}
              confirmedDrugs={confirmedDrugs}
              onConfirm={confirmMed}
              live={live}
            />
            <NotePanel
              note={note}
              specialty={specialty}
              live={phase === 'listening'}
              assessmentAdds={assessmentAdds}
            />
          </div>
          <LiveRail
            reasoning={reasoning}
            findings={findings}
            recs={recs}
            criticalOpen={criticalOpen}
            live={live}
            onDismiss={dismissQuestion}
            onAsked={(id, label) => void relaySuggestion('acted', id, 'ASK_NEXT', label)}
            onEvidence={highlightEvidence}
            onAddToAssessment={addToAssessment}
            addedToAssessment={assessmentAdds}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function StartPanel({ connecting }: { connecting: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span
        aria-hidden
        className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      >
        <MicIcon className="h-7 w-7" />
      </span>
      <div>
        <h2 className="font-serif text-2xl">The note writes itself while you consult.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Press start and allow the mic. The transcript and structured note build in real time, and
          the Live Copilot surfaces red flags, drug-interaction checks and coding nudges as you
          talk. Audio is streamed for transcription, not stored.
        </p>
      </div>
      {connecting && (
        <p className="text-sm text-[var(--color-ink-3)]">Connecting to the gateway…</p>
      )}
    </Card>
  );
}

function TranscriptPanel({
  utterances,
  highlightIds,
  refs,
  listening,
}: {
  utterances: Utterance[];
  highlightIds: Set<string>;
  refs: MutableRefObject<Map<string, HTMLDivElement | null>>;
  listening: boolean;
}) {
  return (
    <PanelShell title="Live transcript">
      {utterances.length === 0 ? (
        <Empty>Your conversation appears here, speaker by speaker.</Empty>
      ) : (
        <div className="space-y-3.5">
          {utterances.map((u) => {
            const hit = highlightIds.has(u.id);
            return (
              <div
                key={u.id}
                ref={(el) => {
                  refs.current.set(u.id, el);
                }}
                className={`-mx-2 rounded-lg px-2 py-1 transition-colors duration-500 ${
                  hit ? 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]' : ''
                }`}
              >
                <p
                  className={`mb-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    u.speaker === 'patient' ? 'text-[#2f5aa8]' : 'text-[var(--color-accent)]'
                  }`}
                >
                  {u.speaker === 'patient'
                    ? 'Patient'
                    : u.speaker === 'doctor'
                      ? 'Doctor'
                      : 'Speaker'}
                </p>
                <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">{u.text}</p>
              </div>
            );
          })}
        </div>
      )}
      {listening && (
        <div className="mt-4 flex items-center gap-2 text-[11.5px] text-[var(--color-ink-3)]">
          <Waveform small />
          listening · transcribing in real time
        </div>
      )}
    </PanelShell>
  );
}

// Sprint DS4 — the live copilot rail: a persistent clinical picture in three
// stacked zones. ASK NEXT (pinned) → DIFFERENTIAL (evidence-cited, tap a chip
// to highlight its source in the transcript) → SAFETY & MORE (the card feed).
const LIKELIHOOD_PCT: Record<LiveReasoning['differential'][number]['likelihood'], number> = {
  high: 90,
  moderate: 55,
  low: 25,
};
const TREND_GLYPH: Record<LiveReasoning['differential'][number]['trend'], string> = {
  new: '•',
  up: '↑',
  down: '↓',
  steady: '→',
};

function LiveRail({
  reasoning,
  findings,
  recs,
  criticalOpen,
  live,
  onDismiss,
  onAsked,
  onEvidence,
  onAddToAssessment,
  addedToAssessment,
}: {
  reasoning: LiveReasoning | null;
  findings: ClinicalFinding[];
  recs: Rec[];
  criticalOpen: boolean;
  live: boolean;
  onDismiss: (id: string, label?: string) => void;
  onAsked: (id: string, label?: string) => void;
  onEvidence: (findingIds: string[]) => void;
  onAddToAssessment: (dxId: string, label: string) => void;
  addedToAssessment: string[];
}) {
  return (
    <div className="space-y-4">
      <AskNextZone askNext={reasoning?.askNext ?? []} onAsked={onAsked} onDismiss={onDismiss} />
      <DifferentialZone
        reasoning={reasoning}
        findings={findings}
        live={live}
        onEvidence={onEvidence}
        onAddToAssessment={onAddToAssessment}
        addedToAssessment={addedToAssessment}
      />
      <CopilotRail recs={recs} criticalOpen={criticalOpen} />
    </div>
  );
}

function AskNextZone({
  askNext,
  onAsked,
  onDismiss,
}: {
  askNext: LiveReasoning['askNext'];
  onAsked: (id: string, label?: string) => void;
  onDismiss: (id: string, label?: string) => void;
}) {
  if (askNext.length === 0) return null;
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-accent-soft)] px-5 py-3">
        <QIcon />
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">
          Ask next
        </h2>
        <span className="ml-auto text-[11px] text-[var(--color-ink-3)]">
          {askNext.filter((q) => q.status === 'open').length} open
        </span>
      </div>
      <ul className="divide-y divide-[var(--color-line-soft)]">
        {askNext.map((q) => {
          const answered = q.status === 'answered';
          return (
            <li key={q.id} className="group flex items-start gap-2 px-4 py-2.5 text-[12.5px]">
              <span className="flex-1 leading-snug">
                {answered && <span className="mr-1 font-bold text-[var(--color-accent)]">✓</span>}
                <span
                  className={
                    answered
                      ? 'text-[var(--color-ink-3)] line-through'
                      : 'font-medium text-[var(--color-ink)]'
                  }
                >
                  {clean(q.question) ?? q.question}
                </span>
                {!answered && q.why && (
                  <span className="block text-[11px] text-[var(--color-ink-3)]">
                    {q.why}
                    {q.source === 'TEMPLATE' ? ' · template' : ''}
                  </span>
                )}
              </span>
              {!answered && (
                <span className="flex shrink-0 gap-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onAsked(q.id, q.question)}
                    className="rounded px-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                    title="Mark as asked"
                  >
                    asked
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(q.id, q.question)}
                    className="rounded px-1 text-[11px] text-[var(--color-ink-3)] hover:text-[var(--color-warn)]"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DifferentialZone({
  reasoning,
  findings,
  live,
  onEvidence,
  onAddToAssessment,
  addedToAssessment,
}: {
  reasoning: LiveReasoning | null;
  findings: ClinicalFinding[];
  live: boolean;
  onEvidence: (findingIds: string[]) => void;
  onAddToAssessment: (dxId: string, label: string) => void;
  addedToAssessment: string[];
}) {
  const labelOf = (id: string) => findings.find((f) => f.id === id)?.label;
  const differential = reasoning?.differential ?? [];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <span className="h-2 w-2 rounded-full bg-[#2f5aa8] ring-4 ring-[#dbe6f7]" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#2f5aa8]">Differential</h2>
        <span className="ml-auto text-[11px] text-[var(--color-ink-3)]">evidence-cited · live</span>
      </div>

      {differential.length === 0 ? (
        <div className="px-5 py-6 text-center text-[13px] text-[var(--color-ink-3)]">
          {live
            ? 'Building the differential as the history unfolds — deterministic checks (right) are running now.'
            : 'The ranked differential appears here as the consult begins.'}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-line-soft)]">
          {differential.map((d) => {
            const added = addedToAssessment.includes(clean(d.label) ?? d.label);
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                    {clean(d.label) ?? d.label}
                  </span>
                  {d.urgent && (
                    <span className="rounded-full bg-[#fbe4e0] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#c0392b]">
                      Urgent
                    </span>
                  )}
                  <span
                    className="ml-auto text-[13px] font-bold text-[var(--color-ink-3)]"
                    title={`trend: ${d.trend}`}
                  >
                    {TREND_GLYPH[d.trend]}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                    <span
                      className="block h-full rounded-full bg-[#2f5aa8] transition-[width] duration-500"
                      style={{ width: `${LIKELIHOOD_PCT[d.likelihood]}%` }}
                    />
                  </span>
                  <span className="text-[10.5px] uppercase tracking-wide text-[var(--color-ink-3)]">
                    {d.likelihood}
                    {d.icd10 ? ` · ${d.icd10}` : ''}
                  </span>
                </div>
                {d.evidenceFor.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {d.evidenceFor.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onEvidence([id])}
                        className="rounded-full border border-[var(--color-line-soft)] bg-white px-2 py-0.5 text-[10.5px] text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        title="Show the source in the transcript"
                      >
                        {clean(labelOf(id)) ?? id}
                      </button>
                    ))}
                  </div>
                )}
                {d.discriminator && (
                  <p className="mt-1.5 text-[11.5px] text-[var(--color-ink-3)]">
                    Discriminate: {d.discriminator}
                  </p>
                )}
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onAddToAssessment(d.id, d.label)}
                  className={`mt-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    added
                      ? 'text-[var(--color-ink-3)]'
                      : 'text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]'
                  }`}
                >
                  {added ? '✓ In assessment' : '+ Add to assessment'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Sprint DS5 — the Rx-first artifact assembling live. Continued meds carry
// forward; AI/voice-drafted rows land pending until the doctor confirms.
function RxPadPanel({
  rxPad,
  confirmedDrugs,
  onConfirm,
  live,
}: {
  rxPad: RxPadDraft | null;
  confirmedDrugs: Set<string>;
  onConfirm: (drug: string) => void;
  live: boolean;
}) {
  const meds = rxPad?.meds ?? [];
  const investigations = rxPad?.investigations ?? [];
  const advice = rxPad?.adviceLines ?? [];
  const empty = !rxPad || (meds.length === 0 && investigations.length === 0 && advice.length === 0);
  return (
    <PanelShell
      title="Prescription ℞"
      right={
        live ? (
          <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
            assembling
          </span>
        ) : undefined
      }
    >
      {empty ? (
        <Empty>The prescription assembles here as you decide on medications and orders.</Empty>
      ) : (
        <div className="space-y-4">
          {rxPad?.dxLine && (
            <div>
              <SectionLabel>Diagnosis</SectionLabel>
              <p className="mt-1 text-[14px] font-medium text-[var(--color-ink)]">
                {clean(rxPad.dxLine) ?? rxPad.dxLine}
              </p>
            </div>
          )}
          {(rxPad?.vitalsLine || (rxPad?.allergies?.length ?? 0) > 0) && (
            <p className="text-[12px] text-[var(--color-ink-3)]">
              {rxPad?.vitalsLine}
              {rxPad?.allergies && rxPad.allergies.length > 0 && (
                <span className="ml-2 text-[var(--color-warn)]">
                  ⚠ Allergies: {rxPad.allergies.join(', ')}
                </span>
              )}
            </p>
          )}

          {meds.length > 0 && (
            <div>
              <SectionLabel>Medications</SectionLabel>
              <ul className="mt-1.5 divide-y divide-[var(--color-line-soft)] rounded-xl border border-[var(--color-line-soft)]">
                {meds.map((m, i) => {
                  const confirmed = m.status === 'confirmed' || confirmedDrugs.has(medKey(m.drug));
                  return (
                    <li key={`${m.drug}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          confirmed ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-warn)]'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                          {clean(m.drug) ?? m.drug}
                        </span>
                        {m.strength && (
                          <span className="text-[13px] text-[var(--color-ink-2)]">
                            {' '}
                            {m.strength}
                          </span>
                        )}
                        <span className="ml-2 text-[12px] text-[var(--color-ink-3)]">
                          {[m.frequency, m.timing, m.durationDays ? `${m.durationDays}d` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {m.warnings.length > 0 && (
                          <span className="ml-2 text-[11px] text-[var(--color-warn)]">
                            ⚠ {m.warnings[0]}
                          </span>
                        )}
                      </span>
                      {m.continued ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                          continued
                        </span>
                      ) : confirmed ? (
                        <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)]">
                          ✓ confirmed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onConfirm(m.drug)}
                          className="shrink-0 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)] hover:brightness-95"
                        >
                          Confirm
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {investigations.length > 0 && (
            <div>
              <SectionLabel>Investigations</SectionLabel>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {investigations.map((inv) => (
                  <span
                    key={inv.name}
                    className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-xs"
                    title={inv.rationale}
                  >
                    {inv.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {advice.length > 0 && (
            <div>
              <SectionLabel>Advice</SectionLabel>
              <ul className="mt-1 space-y-0.5">
                {advice.map((a) => (
                  <li key={a} className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
                    • {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rxPad?.followUp?.when && (
            <div>
              <SectionLabel>Follow-up</SectionLabel>
              <p className="mt-1 text-[13.5px] text-[var(--color-ink)]">
                {rxPad.followUp.when}
                {rxPad.followUp.withWhat ? ` · ${rxPad.followUp.withWhat}` : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function NotePanel({
  note,
  specialty,
  live,
  assessmentAdds,
}: {
  note: PartialStructuredNote;
  specialty?: string | null;
  live: boolean;
  assessmentAdds: string[];
}) {
  const v = note.vitals;
  const vitals = v
    ? [
        v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
        v.heartRateBpm ? `HR ${v.heartRateBpm}` : null,
        v.respRateBpm ? `RR ${v.respRateBpm}` : null,
        v.tempCelsius ? `Temp ${v.tempCelsius}°C` : null,
        v.spo2Pct ? `SpO₂ ${v.spo2Pct}%` : null,
        v.weightKg ? `Wt ${v.weightKg} kg` : null,
      ].filter(Boolean)
    : [];
  const empty =
    !note.chiefComplaint &&
    !note.hpi &&
    !note.assessment &&
    !note.plan &&
    vitals.length === 0 &&
    assessmentAdds.length === 0;

  return (
    <PanelShell
      title="Encounter note"
      right={
        specialty ? (
          <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
            {specialty}
          </span>
        ) : undefined
      }
    >
      {empty ? (
        <Empty>The structured note fills in from the conversation as the consult goes.</Empty>
      ) : (
        <div className="space-y-4">
          <Section label="Chief complaint" value={clean(note.chiefComplaint)} live={live} />
          <Section label="History of present illness" value={clean(note.hpi)} live={live} />
          {vitals.length > 0 && (
            <div>
              <SectionLabel>Vitals</SectionLabel>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {vitals.map((x) => (
                  <span
                    key={x as string}
                    className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-xs"
                  >
                    {x}
                  </span>
                ))}
              </div>
            </div>
          )}
          {note.reviewOfSystems && note.reviewOfSystems.length > 0 && (
            <Section
              label="Review of systems"
              value={note.reviewOfSystems.join(', ')}
              live={live}
            />
          )}
          <Section label="Assessment" value={clean(note.assessment)} live={live} />
          {assessmentAdds.length > 0 && (
            <div>
              <SectionLabel>Added from differential</SectionLabel>
              <ul className="mt-1 space-y-0.5">
                {assessmentAdds.map((a) => (
                  <li key={a} className="text-[14px] leading-relaxed text-[var(--color-ink)]">
                    • {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Section label="Plan" value={clean(note.plan)} live={live} />
        </div>
      )}
    </PanelShell>
  );
}

function CopilotRail({ recs, criticalOpen }: { recs: Rec[]; criticalOpen: boolean }) {
  return (
    <Card className="flex flex-col overflow-hidden bg-gradient-to-b from-white to-[var(--color-surface-soft)] p-0">
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] ring-4 ring-[var(--color-accent-soft)]" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">
          Live Copilot
        </h2>
        <span className="ml-auto text-[11px] text-[var(--color-ink-3)]">updates as you talk</span>
      </div>
      <div className="space-y-3 p-4">
        {recs.length === 0 ? (
          <div className="px-1 py-6 text-center text-sm text-[var(--color-ink-3)]">
            Red flags, drug-interaction checks, coding nudges and heard commands appear here —
            ranked by urgency.
          </div>
        ) : (
          recs.map((r, i) => <CopilotCard key={`${r.kind}-${i}`} rec={r} isNew={i === 0} />)
        )}
      </div>
      {criticalOpen && (
        <div className="mt-auto border-t border-[var(--color-line-soft)] bg-[var(--color-crit-soft,#fbe4e0)] px-5 py-3 text-[12px] font-medium text-[#c0392b]">
          A critical flag is open — review it before you close the encounter.
        </div>
      )}
    </Card>
  );
}

function CopilotCard({ rec, isNew }: { rec: Rec; isNew: boolean }) {
  const s = REC_STYLES[rec.tone];
  return (
    <div
      className="relative rounded-2xl border bg-white p-3.5 pl-4"
      style={{ borderColor: s.border }}
    >
      <span
        className="absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded"
        style={{ background: s.color }}
      />
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
          style={{ background: s.color }}
        >
          {s.icon}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: s.color }}>
          {rec.kindLabel}
        </span>
        {isNew && (
          <span className="ml-auto rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[9.5px] font-extrabold tracking-wide text-[var(--color-accent)]">
            JUST NOW
          </span>
        )}
      </div>
      <p className="mt-2 text-[13.5px] font-medium leading-snug text-[var(--color-ink)]">
        {rec.title}
      </p>
      {rec.detail && (
        <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink-3)]">{rec.detail}</p>
      )}
    </div>
  );
}

function FinalNote({
  note,
  saveState,
  clientId,
  sessionId,
}: {
  note: MedicalEncounterNoteV1;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  clientId?: string;
  sessionId: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-ink-2)]">
        Consult ended — here is the finished note (≈90% drafted before you touched a key):
      </p>
      <Card className="p-7">
        <MedicalNoteView note={note} />
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-[var(--color-ink-2)]">
          {saveState === 'saving' && 'Saving the note to this encounter…'}
          {saveState === 'saved' &&
            '✓ Saved as a draft. Open the encounter to confirm the Rx + orders and sign.'}
          {saveState === 'error' &&
            'Could not save the note automatically — open the encounter and regenerate.'}
          {saveState === 'idle' && 'Open the encounter to review, confirm orders, and sign.'}
        </p>
        {clientId && (
          <a
            href={`/app/patients/${clientId}/encounters/${sessionId}`}
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Open the encounter →
          </a>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recommendation ranking (gaps + voice commands → one ranked feed)   */
/* ------------------------------------------------------------------ */

type Tone = 'crit' | 'warn' | 'interaction' | 'coding' | 'command' | 'info';
interface Rec {
  kind: string;
  kindLabel: string;
  title: string;
  detail?: string;
  tone: Tone;
  severity: 'critical' | 'warn' | 'info';
  rank: number;
}

function rankRecommendations(
  gaps: EncounterGap[],
  commands: VoiceCommand[],
  shownData: Record<string, string>,
): Rec[] {
  const out: Rec[] = [];
  for (const g of gaps) {
    if (g.kind === 'RED_FLAG') {
      out.push({
        kind: g.kind,
        kindLabel: 'Red flag',
        title: g.message,
        tone: 'crit',
        severity: 'critical',
        rank: 0,
      });
    } else if (g.kind === 'DRUG_INTERACTION') {
      out.push({
        kind: g.kind,
        kindLabel: 'Drug interaction',
        title: g.message,
        tone: 'interaction',
        severity: sevOf(g),
        rank: 1,
      });
    } else if (g.kind === 'CODING') {
      out.push({
        kind: g.kind,
        kindLabel: 'Coding · ICD-10',
        title: g.message,
        tone: 'coding',
        severity: 'info',
        rank: 4,
      });
    } else {
      out.push({
        kind: g.kind,
        kindLabel: 'Not documented yet',
        title: g.message,
        tone: 'info',
        severity: sevOf(g),
        rank: 5,
      });
    }
  }
  for (const c of commands) {
    out.push(commandRec(c, shownData));
  }
  // Stable sort by rank, then keep insertion order (newest gaps already last;
  // we reverse within-rank so the most recent surfaces near the top of its band).
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.rank - b.r.rank || b.i - a.i)
    .map((x) => x.r);
}

function sevOf(g: EncounterGap): 'critical' | 'warn' | 'info' {
  return g.severity === 'critical' ? 'critical' : g.severity === 'warn' ? 'warn' : 'info';
}

function commandRec(c: VoiceCommand, shownData: Record<string, string>): Rec {
  if (c.kind === 'ADD_MEDICATION') {
    const detail = [
      c.drug,
      c.strength,
      c.frequency,
      c.durationDays ? `${c.durationDays} days` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      kind: 'ADD_MEDICATION',
      kindLabel: 'Voice command · Rx',
      title: `Add to prescription: ${detail}`,
      detail: 'Heard from your speech — drafts into the Rx for you to confirm.',
      tone: 'command',
      severity: 'info',
      rank: 2,
    };
  }
  if (c.kind === 'ORDER_TEST') {
    return {
      kind: 'ORDER_TEST',
      kindLabel: 'Voice command · Order',
      title: `Order: ${c.description}`,
      detail: 'Heard from your speech — drafts into orders for you to confirm.',
      tone: 'command',
      severity: 'info',
      rank: 2,
    };
  }
  const resolved = shownData[c.measure];
  return {
    kind: 'SHOW_DATA',
    kindLabel: 'Voice command · Data',
    title: `${c.measure}${resolved ? `: ${resolved}` : ' — fetching latest…'}`,
    tone: 'command',
    severity: 'info',
    rank: 3,
  };
}

const REC_STYLES: Record<Tone, { color: string; border: string; icon: ReactNode }> = {
  crit: { color: '#c0392b', border: '#f0c5bd', icon: <AlertIcon /> },
  warn: { color: '#b86a3c', border: '#f2d9c8', icon: <AlertIcon /> },
  interaction: { color: '#b86a3c', border: '#f2d9c8', icon: <PillIcon /> },
  coding: { color: '#2f5aa8', border: '#cdd9ef', icon: <TagIcon /> },
  command: { color: '#2d5f4d', border: '#cfe0d6', icon: <MicIcon className="h-[15px] w-[15px]" /> },
  info: { color: '#6b4fa8', border: '#dccdf1', icon: <QIcon /> },
};

/* ------------------------------------------------------------------ */
/* Small building blocks                                              */
/* ------------------------------------------------------------------ */

function PanelShell({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-3)]">
          {title}
        </h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function Section({ label, value, live }: { label: string; value?: string; live: boolean }) {
  if (!value) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink)]">
        {value}
        {live && (
          <span className="ml-2 inline-block animate-pulse rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 align-[2px] text-[9px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
            live
          </span>
        )}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
      {children}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--color-ink-3)]">{children}</p>;
}

function Waveform({ small }: { small?: boolean }) {
  const bars = small ? [6, 12, 9, 14] : [7, 15, 20, 11, 17, 6, 13, 19, 9];
  return (
    <span className="flex items-end gap-[3px]" style={{ height: small ? 14 : 20 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current opacity-60 animate-pulse"
          style={{ height: h, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  );
}

/* Icons (stroke, inherit currentColor unless white on a chip) */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V8a4 4 0 0 1 4-4zM5 12a7 7 0 0 0 14 0M12 19v3" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
function PillIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3h4v4h-4zM7 7h10l-1 12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}
function QIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}

/* Helpers */
const MOCK_TAG = /^\s*\[mock\]\s*/i;
function clean(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.replace(MOCK_TAG, '').trim();
  return t.length ? t : undefined;
}

// Sprint DS5 — dedup key for a drug (first significant word, lowercased).
function medKey(drug: string): string {
  return drug.replace(MOCK_TAG, '').toLowerCase().split(/\s+/)[0] ?? drug;
}

// Sprint DS5 — fold the doctor's confirmations into the final pad so the
// persisted Rx reflects what they actually signed off.
function confirmRxPad(pad: RxPadV1, confirmed: Set<string>): RxPadV1 {
  return {
    ...pad,
    meds: pad.meds.map((m) =>
      m.status === 'pending' && confirmed.has(medKey(m.drug))
        ? { ...m, status: 'confirmed' as const }
        : m,
    ),
  };
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function initials(name?: string | null): string {
  if (!name) return '·';
  const parts = name
    .replace(/^dr\.?\s*/i, '')
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}
