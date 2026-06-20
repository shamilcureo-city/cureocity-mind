import type {
  ClinicalOrderV1,
  EncounterGap,
  LiveGatewayEvent,
  MedicalEncounterNoteV1,
  MedicationOrderV1,
} from '@cureocity/contracts';
import type { SpeakerSegment } from '@cureocity/llm';
import {
  checkInteractions,
  formatInteraction,
  parseVoiceCommands,
  type InteractionSeverity,
} from '@cureocity/clinical';
import { detectGaps } from './gaps';
import type { LiveBackends } from './llm';

/**
 * Sprint DV4 (full) — the real live encounter session.
 *
 * This is NOT a scripted mock. The browser streams raw PCM audio frames
 * (16 kHz mono signed 16-bit LE) over the socket; on a fixed cadence we
 * run the SAME proven pipeline the batch path uses:
 *
 *   Rail 1 — Pass 1 (transcription) on the rolling audio buffer → the
 *            growing transcript.
 *   Rail 2 — Pass 2 (vertical=DOCTOR → MedicalEncounterNoteV1) on the
 *            transcript so far → the note building itself.
 *   Rail 3 — the deterministic gap / red-flag engine (gaps.ts) over the
 *            transcript + the building note.
 *
 * With LLM_BACKEND=mock this runs locally (deterministic backends, no
 * creds). With LLM_BACKEND=vertex it is genuinely real: real audio →
 * real Vertex transcription → real Gemini note → real flags. The only
 * thing layered on top later is token-streaming ASR for lower latency
 * (docs/DOCTOR_VERTICAL.md §4.3); the clinical substance is real today.
 */

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2; // signed 16-bit LE, mono
/** How often we re-run the pipeline on the rolling buffer. */
const CYCLE_MS = 4_000;

type Emit = (event: LiveGatewayEvent) => void;

export class LiveSession {
  private readonly emit: Emit;
  private readonly backends: LiveBackends;
  private readonly sessionId: string;
  private readonly specialty: string | null;

  private audio: Buffer[] = [];
  private totalBytes = 0;

  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private dirty = false;
  private stopped = false;

  /** Cumulative transcript already emitted, for computing the next delta. */
  private lastTranscript = '';
  /** Last note JSON we emitted, to suppress identical re-emits. */
  private lastNoteJson = '';
  /** Gap messages already surfaced, so each flag fires once. */
  private readonly seenGaps = new Set<string>();
  /** Voice-command clauses already surfaced, so each fires once. */
  private readonly seenCommands = new Set<string>();
  /** The most recent structured note, used as the final if none newer. */
  private latestNote: MedicalEncounterNoteV1 | null = null;
  /** The most recent drafted Rx + orders, sent with the final note. */
  private latestMedications: MedicationOrderV1[] = [];
  private latestOrders: ClinicalOrderV1[] = [];

  constructor(sessionId: string, specialty: string | null, backends: LiveBackends, emit: Emit) {
    this.sessionId = sessionId;
    this.specialty = specialty;
    this.backends = backends;
    this.emit = emit;
  }

  start(): void {
    this.emit({ type: 'status', state: 'listening' });
    this.timer = setInterval(() => void this.tick(), CYCLE_MS);
  }

  /** Append a chunk of PCM audio streamed from the browser. */
  pushAudio(chunk: Buffer): void {
    if (this.stopped || chunk.length === 0) return;
    this.audio.push(chunk);
    this.totalBytes += chunk.length;
    this.dirty = true;
  }

  private durationMs(): number {
    return Math.round((this.totalBytes / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000);
  }

  /** Run the pipeline once on the rolling buffer (Rails 1-3). */
  private async tick(): Promise<void> {
    if (this.busy || !this.dirty || this.stopped || this.totalBytes === 0) return;
    this.busy = true;
    this.dirty = false;
    try {
      await this.runPipeline(false);
    } catch (err) {
      console.error('[live-gateway] tick failed:', (err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Transcribe the rolling buffer, structure it, and flag gaps — emitting
   * only what's new. `isFinal` marks the closing pass after the doctor
   * ends the consult.
   */
  private async runPipeline(isFinal: boolean): Promise<void> {
    const audioBytes = Buffer.concat(this.audio, this.totalBytes);

    const pass1 = await this.backends.pass1.run({
      sessionId: this.sessionId,
      audioBytes,
      durationMs: this.durationMs(),
    });
    const transcript = pass1.output.transcript;
    const segments = pass1.output.speakerSegments;

    this.emitTranscriptDelta(transcript, segments);

    // Sprint DV6.4 — recognised voice commands (transcript-only, so they
    // surface even before the note structures). The doctor confirms them.
    if (!isFinal) {
      for (const command of parseVoiceCommands(transcript)) {
        if (this.seenCommands.has(command.raw)) continue;
        this.seenCommands.add(command.raw);
        this.emit({ type: 'command', command });
      }
    }

    const pass2 = await this.backends.pass2.run({
      sessionId: this.sessionId,
      transcript,
      speakerSegments: segments,
      kind: 'TREATMENT',
      modality: null,
      vertical: 'DOCTOR',
      clientContext: {},
    });

    if (pass2.output.kind !== 'MEDICAL') return; // defensive — DOCTOR always MEDICAL
    const note = pass2.output.encounterNote;
    const medications = pass2.output.medications;
    this.latestNote = note;
    this.latestMedications = medications;
    this.latestOrders = pass2.output.orders;

    if (isFinal) {
      this.emit({ type: 'final', note, medications, orders: pass2.output.orders });
      return;
    }

    const noteJson = JSON.stringify(note);
    if (noteJson !== this.lastNoteJson) {
      this.lastNoteJson = noteJson;
      this.emit({ type: 'note', partial: note });
    }

    for (const gap of detectGaps(transcript, note, this.specialty)) {
      if (this.seenGaps.has(gap.message)) continue;
      this.seenGaps.add(gap.message);
      this.emit({ type: 'gap', gap: gap satisfies EncounterGap });
    }

    // Sprint DV5 — Rail-3 💊 flag. Deterministic interaction-check over
    // the drafted Rx, emitted as a DRUG_INTERACTION gap.
    for (const interaction of checkInteractions(medications.map((m) => m.drug))) {
      const message = formatInteraction(interaction);
      if (this.seenGaps.has(message)) continue;
      this.seenGaps.add(message);
      this.emit({
        type: 'gap',
        gap: {
          kind: 'DRUG_INTERACTION',
          severity: interactionSeverity(interaction.severity),
          message,
        },
      });
    }
  }

  /** Emit the transcript suffix when cumulative, else the whole new text. */
  private emitTranscriptDelta(transcript: string, segments: SpeakerSegment[]): void {
    let deltaText = transcript;
    if (this.lastTranscript && transcript.startsWith(this.lastTranscript)) {
      deltaText = transcript.slice(this.lastTranscript.length);
    }
    deltaText = deltaText.trim();
    if (deltaText.length === 0) return;
    this.lastTranscript = transcript;

    const last = segments[segments.length - 1];
    const speaker =
      last?.speaker === 'therapist' ? 'doctor' : last?.speaker === 'client' ? 'patient' : 'unknown';
    this.emit({
      type: 'transcript',
      delta: { text: deltaText, isFinal: false, speaker },
    });
  }

  /** Doctor ended the consult: run a closing pass on the full audio. */
  async finalize(): Promise<void> {
    if (this.stopped) return;
    this.stopAudio();
    this.emit({ type: 'status', state: 'finalizing' });
    try {
      if (this.totalBytes > 0) {
        await this.runPipeline(true);
      } else if (this.latestNote) {
        this.emitFinalFromLatest();
      }
    } catch (err) {
      console.error('[live-gateway] finalize failed:', (err as Error).message);
      this.emitFinalFromLatest();
    } finally {
      this.emit({ type: 'status', state: 'done' });
    }
  }

  private emitFinalFromLatest(): void {
    if (!this.latestNote) return;
    this.emit({
      type: 'final',
      note: this.latestNote,
      medications: this.latestMedications,
      orders: this.latestOrders,
    });
  }

  private stopAudio(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stopAudio();
    this.audio = [];
    this.totalBytes = 0;
  }
}

/** Map a drug-interaction severity to the EncounterGap severity scale. */
function interactionSeverity(s: InteractionSeverity): 'info' | 'warn' | 'critical' {
  if (s === 'contraindicated' || s === 'major') return 'critical';
  if (s === 'moderate') return 'warn';
  return 'info';
}
