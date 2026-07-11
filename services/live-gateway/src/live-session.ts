import type {
  AskNextItem,
  ClinicalOrderV1,
  EncounterGap,
  IntakeNoteV1,
  LiveGatewayEvent,
  MedicalEncounterNoteV1,
  MedicationOrderV1,
  PatientContext,
  PractitionerVertical,
  RxPadV1,
  SessionKind,
  SessionModality,
  TherapyLiveContext,
  TherapyNoteV1,
  Utterance,
  VoiceCommand,
} from '@cureocity/contracts';
import type { SpeakerSegment } from '@cureocity/llm';
import {
  checkInteractions,
  formatInteraction,
  parseVoiceCommands,
  resolveSpecialtyTemplate,
  templateAskNext,
  type EncounterCompletenessInput,
  type InteractionSeverity,
} from '@cureocity/clinical';
import { CaseStateStore } from './case-state';
import { detectGaps } from './gaps';
import type { LiveBackends } from './llm';
import { ConsultMeter } from './meter';
import { ReasoningScheduler } from './reasoning-loop';
import { TherapyReasoningStore } from './therapy-reasoning';
import { assembleRxPad } from './rx-pad';
import {
  bytesToMs,
  DEFAULT_WINDOW_OPTIONS,
  isSilent,
  nextWindowBoundary,
  type WindowOptions,
} from './vad';

/**
 * Sprint DV4 (full) + DS0 rework — the real live encounter session.
 *
 * The browser streams raw PCM audio frames (16 kHz mono s16le) over the
 * socket. The DS0 change is the transcription cadence:
 *
 *   BEFORE — every 4s we re-transcribed the ENTIRE rolling buffer. At
 *            minute 20 that re-sent 20 minutes of audio: per-tick tokens,
 *            cost and latency grew without bound (O(n²) in consult length).
 *
 *   NOW    — the stream is segmented at silence boundaries (see vad.ts)
 *            into bounded ~15–30s windows, and Pass 1 transcribes each NEW
 *            window exactly once. We keep an ordered list of Utterances;
 *            the cumulative transcript is just their text joined. Total
 *            transcription work is O(n). A ConsultMeter records tokens /
 *            cost / latency per call and the gateway emits a `meter` event.
 *
 * The three rails are unchanged in spirit:
 *   Rail 1 — Pass 1 (transcription) per window → the growing transcript.
 *   Rail 2 — Pass 2 (vertical=DOCTOR → MedicalEncounterNoteV1) on the
 *            cumulative transcript once per window → the note building.
 *   Rail 3 — the deterministic gap / red-flag / interaction engine.
 *
 * With LLM_BACKEND=mock this runs locally (deterministic, no creds); with
 * vertex it is genuinely real. See docs/DOCTOR_VERTICAL.md §4 +
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS0.
 */

/**
 * How often we check whether a window is ready to close. Sprint 74 — 1 s
 * (was 3 s): the tick adds dead time on top of the window itself, and the
 * pump is re-entrancy-guarded (`busy`) so a faster tick can't overlap a
 * slow Pass 1; a no-op tick is just a cheap buffer-length check.
 */
const CYCLE_MS = 1_000;

/**
 * Sprint 74 — minimum NEW transcript (ms of speech) between interim note
 * passes. The note pass used to re-run on the full cumulative transcript
 * after EVERY window — the dominant cost of a consult (O(n²) input, one
 * full structured note billed as output per 6–12 s window, ~10–25× the
 * ₹3/consult budget in budgets.ts). The live surfaces the doctor watches
 * (findings / differential / ask-next) come from the separate reasoning
 * pass and are untouched by this debounce; the structured note only needs
 * a periodic refresh plus the authoritative run at finalize. 0 restores
 * note-per-window.
 */
function noteRefreshMsFromEnv(): number {
  const raw = process.env['LIVE_NOTE_REFRESH_MS'];
  if (!raw) return 40_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 600_000 ? n : 40_000;
}

function numEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * DOC-5 — runaway-consult guards. A forgotten/open mic must not transcribe
 * dead air forever or run Vertex passes without a ceiling.
 *   - skipSilentWindows: drop a fully-silent window before Pass 1 (default on).
 *   - maxConsultMs: hard cap on consult length → auto-finalize (default 90 min).
 *   - costCeilingInr: cap on accumulated LLM spend → auto-finalize (default ₹15,
 *     well above the ₹2–3 target so a normal consult is never interrupted).
 */
function runawayGuardsFromEnv() {
  return {
    skipSilentWindows: process.env['LIVE_SKIP_SILENT_WINDOWS'] !== 'false',
    maxConsultMs: numEnv('LIVE_MAX_CONSULT_MS', 90 * 60_000, 60_000, 6 * 60 * 60_000),
    costCeilingInr: numEnv('LIVE_COST_CEILING_INR', 15, 1, 1000),
  };
}

type Emit = (event: LiveGatewayEvent) => void;

export class LiveSession {
  private readonly emit: Emit;
  private readonly backends: LiveBackends;
  private readonly sessionId: string;
  private readonly specialty: string | null;
  private readonly windowOpts: WindowOptions;
  private readonly meter = new ConsultMeter();
  /** Sprint DS1 — the per-consult reasoning substrate (findings + citation gate). */
  private readonly caseStore: CaseStateStore;
  /** Sprint DS2 — debounces + coalesces reasoning passes. */
  private readonly reasoningScheduler = new ReasoningScheduler();

  /** Sprint TS5 — therapist live copilot state (null for doctors). */
  private readonly therapyStore: TherapyReasoningStore | null;

  /** Un-flushed audio (bytes not yet transcribed into an utterance). */
  private pending: Buffer = Buffer.alloc(0);
  /** All-time bytes received, for wall offsets. */
  private totalBytes = 0;
  /** DOC-9 — wall-clock (ms) of the first audio byte; anchors the honest
   *  speech→transcript latency via the real-time byte↔time mapping. */
  private captureStartMs = 0;
  /** All-time bytes already transcribed (the window cursor). */
  private flushedBytes = 0;
  /** Monotonic window counter, for stable utterance ids. */
  private windowIndex = 0;

  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  /** One-shot guard so `final` is emitted at most once (real note or fallback). */
  private finalEmitted = false;
  private startedAtMs = 0;
  /** DOC-5 — runaway-consult guards (silence skip + duration/cost ceilings). */
  private readonly guards = runawayGuardsFromEnv();
  /** Set once a ceiling trips, so pump auto-finalizes exactly once. */
  private autoFinalizing = false;

  /** Ordered finalized windows — the source of truth for the transcript. */
  private readonly utterances: Utterance[] = [];
  /** Accumulated diarized segments (wall-offset), fed to Pass 2. */
  private readonly segments: SpeakerSegment[] = [];

  /** Last note JSON we emitted, to suppress identical re-emits. */
  private lastNoteJson = '';
  /** Gap messages already surfaced, so each flag fires once. */
  private readonly seenGaps = new Set<string>();
  /** Voice-command clauses already surfaced, so each fires once. */
  private readonly seenCommands = new Set<string>();
  /** The most recent structured note, used as the final if none newer. */
  private latestNote: MedicalEncounterNoteV1 | null = null;
  private latestMedications: MedicationOrderV1[] = [];
  private latestOrders: ClinicalOrderV1[] = [];
  /** Sprint TS1 — practitioner vertical + (therapist) session kind/modality. */
  private readonly vertical: PractitionerVertical;
  private readonly sessionKind: SessionKind;
  private readonly sessionModality: SessionModality | null;
  /** Sprint TS1 — the therapist's latest note (SOAP or intake), for the final. */
  private latestTherapyNote: TherapyNoteV1 | IntakeNoteV1 | null = null;
  private latestTherapyKind: SessionKind = 'TREATMENT';
  /** Sprint DS5 — voice-command meds/orders accumulated for the Rx pad. */
  private readonly voiceCommands: VoiceCommand[] = [];
  /** Last Rx-pad JSON emitted, to suppress identical re-emits. */
  private lastRxJson = '';

  /** Transcript end (ms) when the interim note last ran — the debounce cursor. */
  private lastNoteTranscriptEndMs = -1;
  private readonly noteRefreshMs: number;

  constructor(
    sessionId: string,
    specialty: string | null,
    backends: LiveBackends,
    emit: Emit,
    windowOpts: WindowOptions = DEFAULT_WINDOW_OPTIONS,
    patientContext?: PatientContext,
    noteRefreshMs?: number,
    // Sprint TS1 — the therapist live scribe rides the same gateway. Defaults
    // keep the shipped doctor path byte-identical.
    vertical: PractitionerVertical = 'DOCTOR',
    sessionKind: SessionKind = 'TREATMENT',
    sessionModality: SessionModality | null = null,
    // Sprint TS5 — therapist live copilot context (carried questions + prior
    // risk + planned length). Null for doctors and for a thin therapist start.
    therapyContext: TherapyLiveContext | null = null,
  ) {
    this.sessionId = sessionId;
    this.specialty = specialty;
    this.backends = backends;
    this.emit = emit;
    this.windowOpts = windowOpts;
    this.vertical = vertical;
    this.sessionKind = sessionKind;
    this.sessionModality = sessionModality;
    // Therapy runs ~45-60 min vs a ~10-min consult, so slow the interim-note
    // refresh to keep Pass-2 spend bounded (the finalize note is never debounced).
    this.noteRefreshMs =
      noteRefreshMs ?? (vertical === 'THERAPIST' ? 90_000 : noteRefreshMsFromEnv());
    this.caseStore = new CaseStateStore(patientContext);
    this.therapyStore = vertical === 'THERAPIST' ? new TherapyReasoningStore(therapyContext) : null;
  }

  start(): void {
    this.startedAtMs = Date.now();
    this.emit({ type: 'status', state: 'listening' });
    this.timer = setInterval(() => void this.pump(), CYCLE_MS);
  }

  /** Per-window Pass-1 input tokens, in order (telemetry + O(n) tests). */
  get transcribeTokenSamples(): readonly number[] {
    return this.meter.transcribeInputTokens;
  }

  /** Append a chunk of PCM audio streamed from the browser. */
  pushAudio(chunk: Buffer): void {
    if (this.stopped || chunk.length === 0) return;
    // DOC-9 — stamp the wall-clock of the very first audio byte. Because the
    // browser streams PCM in real time, a byte at offset b was spoken at
    // ≈ captureStartMs + bytesToMs(b), which lets us measure the honest
    // speech→transcript latency (window-wait included) without per-byte stamps.
    if (this.totalBytes === 0) this.captureStartMs = Date.now();
    // `pending` stays bounded — each closed window slices its prefix off, so
    // this concat is over ~one window of audio, not the whole consult.
    this.pending = Buffer.concat([this.pending, chunk]);
    this.totalBytes += chunk.length;
  }

  /**
   * Close every window the un-flushed tail is ready for. Driven by the tick
   * timer in prod; called directly by tests. Re-entrancy is guarded so a
   * slow Pass 1 can't overlap the next tick — extra windows just wait for
   * the current call to drain them.
   */
  async pump(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.stopped) break;
        // Cheap guard before any silence scan: nothing to close yet.
        if (bytesToMs(this.pending.length) < this.windowOpts.minWindowMs) break;
        const boundary = nextWindowBoundary(this.pending, this.windowOpts);
        if (!boundary) break;
        // Snapshot the window before any await; pushAudio only appends past it.
        const windowPcm = this.pending.subarray(0, boundary.endByte);
        await this.processWindow(windowPcm, boundary.durationMs, boundary.endByte);
      }
    } catch (err) {
      console.error('[live-gateway] window failed:', (err as Error).message);
    } finally {
      this.busy = false;
    }
    // Sprint TS5 — advance the session arc even during silence, so the
    // pacing rail moves through opening → working → closing on its own. Only
    // emits when the arc PHASE changes (the change-key ignores the minute tick).
    if (this.therapyStore && !this.stopped) {
      const { changed, snapshot } = this.therapyStore.recompute(this.elapsedMs());
      if (changed) this.emit({ type: 'therapyReasoning', reasoning: snapshot });
    }

    // DOC-5 — a runaway guard tripped this window: close the consult now (after
    // the pump is idle, so finalize()'s waitIdle doesn't deadlock). finalize()
    // is a no-op if already stopped, so this fires exactly once.
    if (this.autoFinalizing && !this.stopped) void this.finalize();
  }

  /** Milliseconds since start() — drives the therapy session arc. */
  private elapsedMs(): number {
    return this.startedAtMs ? Date.now() - this.startedAtMs : 0;
  }

  /**
   * Transcribe one finalized window (Pass 1 on JUST this window), append
   * the utterance, then rebuild the note + flags on the cumulative
   * transcript. Advances the flush cursor and trims `pending`.
   */
  private async processWindow(
    windowPcm: Buffer,
    durationMs: number,
    consumedBytes: number,
  ): Promise<void> {
    // DOC-5 — a fully-silent window (e.g. a mic left open in an empty room,
    // force-cut at maxWindowMs) has nothing to transcribe. Drop it before
    // Pass 1 so dead air never runs up the Vertex bill. Advance the cursor so
    // the pump doesn't re-scan it.
    if (this.guards.skipSilentWindows && isSilent(windowPcm, this.windowOpts)) {
      this.flushedBytes += consumedBytes;
      this.pending = this.pending.subarray(consumedBytes);
      return;
    }

    const tStartMs = bytesToMs(this.flushedBytes);

    const t0 = Date.now();
    const pass1 = await this.backends.pass1.run({
      sessionId: this.sessionId,
      audioBytes: windowPcm,
      durationMs,
      vertical: this.vertical, // Sprint TS1 — DOCTOR or THERAPIST
    });
    this.meter.recordTranscribe(pass1.callLog, Date.now() - t0);
    this.meter.markWindow();

    // Advance the cursor + trim the buffer (pending may have grown during
    // the await; slicing keeps the leftover + any newly-pushed audio).
    this.flushedBytes += consumedBytes;
    this.pending = this.pending.subarray(consumedBytes);
    const tEndMs = bytesToMs(this.flushedBytes);

    // Anti-hallucination (TS-fix): Pass 1 now returns an EMPTY transcript for a
    // window that carried no discernible speech (silence/room-noise that cleared
    // the energy VAD but wasn't actually speech). Drop it — don't emit a blank
    // utterance or re-run the note/reasoning on nothing. The cursor is already
    // advanced so the window is never re-scanned.
    if (pass1.output.transcript.trim().length === 0) {
      this.emit({ type: 'meter', summary: this.meterSummary() });
      return;
    }

    // Sprint TS-B1 — one utterance per diarized segment (see commitUtterances).
    const utterances = this.commitUtterances(
      pass1.output.transcript,
      pass1.output.speakerSegments,
      tStartMs,
      tEndMs,
    );
    this.recordSpeechToTranscript(tStartMs);
    for (const utterance of utterances) {
      this.emit({
        type: 'transcript',
        delta: {
          text: utterance.text,
          isFinal: true,
          speaker: utterance.speaker,
          startMs: utterance.tStartMs,
          endMs: utterance.tEndMs,
        },
      });
      this.emit({ type: 'utterance', utterance });
    }
    const lastUtterance = utterances[utterances.length - 1]!;

    // Recognised voice commands (transcript-only). The doctor confirms them.
    // DS11.5-fu — a command becomes newly-parseable only once this window
    // completes its clause (seenCommands dedups the re-scan), so the window's
    // last utterance is its source; stamp it on the heard pad-feeding kinds so
    // the browser can render a 🗣 quote-chip back to the transcript.
    for (const command of parseVoiceCommands(this.cumulativeTranscript())) {
      if (this.seenCommands.has(command.raw)) continue;
      this.seenCommands.add(command.raw);
      const anchored =
        command.kind === 'ADD_MEDICATION' || command.kind === 'ORDER_TEST'
          ? { ...command, utteranceId: lastUtterance.id }
          : command;
      this.voiceCommands.push(anchored); // DS5 — feed the Rx pad
      this.emit({ type: 'command', command: anchored });
    }

    // Sprint DS2 — queue the new utterances for the reasoning engine; the
    // scheduler decides whether to run now or coalesce with the next window.
    for (const utterance of utterances) this.reasoningScheduler.enqueue(utterance);
    const due = this.reasoningScheduler.takeDue();
    if (due) {
      if (this.vertical === 'THERAPIST') await this.runTherapyReasoning(due);
      else await this.runReasoning(due);
    }

    await this.runNote(false);
    // DOC-2 — deterministic red-flag / interaction checks EVERY window (not
    // gated by the note-refresh debounce). Pure regex/table lookups, ~0 cost.
    this.runDeterministicChecks();
    this.emit({ type: 'meter', summary: this.meterSummary() });

    // DOC-5 — trip the runaway guard; pump auto-finalizes after this window.
    const overBudget = this.overBudgetReason();
    if (overBudget && !this.autoFinalizing) {
      this.autoFinalizing = true;
      console.warn(`[live-gateway] auto-finalizing sess=${this.sessionId}: ${overBudget}`);
    }
  }

  /** DOC-5 — reason the consult should auto-close (null = within budget). */
  private overBudgetReason(): string | null {
    if (Date.now() - this.startedAtMs >= this.guards.maxConsultMs) {
      return `max consult duration ${Math.round(this.guards.maxConsultMs / 60_000)}min reached`;
    }
    if (this.meterSummary().costInr >= this.guards.costCeilingInr) {
      return `cost ceiling ₹${this.guards.costCeilingInr} reached`;
    }
    return null;
  }

  /**
   * Sprint DS2 — THE reasoning pass. ONE combined Flash call turns the new
   * utterances (given the CaseState + previous differential) into findings-δ
   * + a ranked differential + ask-next + red flags. The gateway then:
   *   1. merges findings under the citation gate (drop fabricated utterance
   *      citations), emitting a `finding` snapshot if it changed;
   *   2. validates the differential against the freshly-merged findings
   *      (drop any candidate whose evidence doesn't resolve), caps + emits a
   *      `reasoning` snapshot if it changed.
   * Failures are logged + swallowed — a reasoning hiccup must never break the
   * scribe (the note + transcript keep flowing).
   */
  private async runReasoning(newUtterances: Utterance[]): Promise<void> {
    // Sprint TS1 — no live differential for therapy (TS5 adds a therapy rail).
    if (this.vertical === 'THERAPIST') return;
    if (newUtterances.length === 0) return;
    try {
      const res = await this.backends.reasoning.run({
        sessionId: this.sessionId,
        caseState: this.caseStore.snapshot,
        previousDifferential: this.caseStore.differential,
        openQuestions: this.caseStore.openQuestions,
        newUtterances,
        ...(this.specialty ? { specialty: this.specialty } : {}),
      });
      this.meter.recordReasoning(res.callLog);

      const merged = this.caseStore.applyFindings(
        res.output.findings,
        res.output.answeredQuestionIds,
      );
      if (merged.changed) {
        this.emit({
          type: 'finding',
          findings: this.caseStore.findings,
          version: this.caseStore.version,
        });
      }

      // DS2 differential (citation-gated) + DS3 ask-next (differential-driven
      // + answered) then the deterministic template-driven questions.
      this.caseStore.applyReasoning(
        res.output.differential,
        res.output.askNext,
        res.output.redFlags,
        res.output.answeredQuestionIds,
        res.output.examineNext,
        res.output.orderNext,
      );
      this.caseStore.applyTemplateGaps(this.templateAskNextFromNote());

      if (this.caseStore.commitReasoning().changed) {
        this.emit({ type: 'reasoning', reasoning: this.caseStore.reasoning });
        this.caseStore.markAskEmitted();
      }
    } catch (err) {
      console.error('[live-gateway] reasoning pass failed:', (err as Error).message);
    }
  }

  /**
   * Sprint TS5 — the live THERAPY reasoning pass. PASS_12 over the new
   * utterances (given the recent tail + the planned questions + prior-risk
   * flag) produces risk cues + live ask-next + unexplored threads. The store
   * then citation-gates + merges them, seeds the CARRIED questions + the
   * deterministic SI re-check, computes the session arc, and we emit a
   * `therapyReasoning` snapshot if anything changed. Failures are logged +
   * swallowed — a copilot hiccup must never break the scribe.
   */
  private async runTherapyReasoning(newUtterances: Utterance[]): Promise<void> {
    const store = this.therapyStore;
    if (!store || newUtterances.length === 0) return;
    try {
      const newIds = new Set(newUtterances.map((u) => u.id));
      const recentUtterances = store.recentTail(newIds);
      store.registerUtterances(newUtterances);

      const res = await this.backends.therapyReasoning.run({
        sessionId: this.sessionId,
        newUtterances,
        recentUtterances,
        carriedQuestions: store.carriedQuestions,
        previousThreads: store.previousThreads(),
        openQuestions: store.openLiveQuestions(),
        priorRisk: store.priorRisk,
      });
      this.meter.recordReasoning(res.callLog);

      const { changed, snapshot } = store.apply(res.output, this.elapsedMs());
      if (changed) this.emit({ type: 'therapyReasoning', reasoning: snapshot });
    } catch (err) {
      console.error('[live-gateway] therapy reasoning pass failed:', (err as Error).message);
    }
  }

  /** Sprint DS3 — deterministic template-completeness questions from the note. */
  private templateAskNextFromNote(): AskNextItem[] {
    const template = resolveSpecialtyTemplate(this.specialty);
    if (!template) return [];
    const note = this.latestNote;
    const input: EncounterCompletenessInput = {
      hpi: note?.hpi ?? '',
      reviewOfSystems: note?.reviewOfSystems ?? [],
      examined: note?.physicalExam?.examined ?? false,
      examFindings: note?.physicalExam?.findings ?? '',
      presentVitals: presentVitalIds(note),
    };
    return templateAskNext(input, template);
  }

  /**
   * Sprint DS3 — the doctor dismissed an "ask next" question. Persist it for
   * the consult (never re-suggest) and re-emit the reasoning snapshot.
   */
  /**
   * Sprint TS-B3 — "Update now": re-run the interim note immediately, bypassing
   * the refresh debounce. Serialized behind the pump's `busy` guard so it can
   * never overlap an in-flight window; a no-op if the consult has stopped. If
   * the regenerated note is unchanged, no event is emitted (the client shows
   * its own "no changes" state).
   */
  requestNoteRefresh(): void {
    if (this.stopped) return;
    void (async () => {
      const deadline = Date.now() + 4_000;
      while (this.busy && Date.now() < deadline)
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      if (this.busy || this.stopped) return;
      this.busy = true;
      try {
        this.lastNoteTranscriptEndMs = Number.NEGATIVE_INFINITY;
        await this.runNote(false);
        this.emit({ type: 'meter', summary: this.meterSummary() });
      } catch (err) {
        console.error('[live-gateway] note refresh failed:', (err as Error).message);
      } finally {
        this.busy = false;
      }
    })();
  }

  dismissQuestion(questionId: string): void {
    // Sprint TS5 — the therapist path dismisses risk/ask/thread cards through
    // the same command; route to the therapy store and re-emit its snapshot.
    if (this.therapyStore) {
      if (this.therapyStore.dismiss(questionId)) {
        const { snapshot } = this.therapyStore.recompute(this.elapsedMs());
        this.emit({ type: 'therapyReasoning', reasoning: snapshot });
      }
      return;
    }
    this.caseStore.dismissAsk(questionId);
    if (this.caseStore.commitReasoning().changed) {
      this.emit({ type: 'reasoning', reasoning: this.caseStore.reasoning });
      this.caseStore.markAskEmitted();
    }
  }

  /**
   * Append this window's speech as utterances + its (wall-offset) segments.
   *
   * Sprint TS-B1 — one utterance PER DIARIZED SEGMENT, not per window. The
   * old code collapsed the whole 6–12s window into a single utterance labeled
   * with the LAST segment's speaker, so multi-turn windows rendered as one
   * mislabeled wall of text ("You:" for everything). Pass 1 already diarizes
   * each segment as therapist/client; keep that. A window whose segments are
   * all empty (diarization failed but speech transcribed) falls back to ONE
   * `unknown`-speaker utterance carrying the whole transcript — unattributed
   * is honest, mislabeled is not.
   */
  private commitUtterances(
    transcript: string,
    segments: SpeakerSegment[],
    tStartMs: number,
    tEndMs: number,
  ): Utterance[] {
    for (const seg of segments) {
      this.segments.push({ ...seg, startMs: seg.startMs + tStartMs, endMs: seg.endMs + tStartMs });
    }
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const speech = segments.filter((s) => s.text.trim().length > 0);
    const out: Utterance[] = [];
    if (speech.length === 0) {
      out.push({
        id: `u${++this.windowIndex}`,
        speaker: 'unknown',
        text: transcript.trim(),
        tStartMs,
        tEndMs,
      });
    } else {
      for (const seg of speech) {
        // Segment times are window-relative; clamp defensively so a garbled
        // model timestamp can never produce an inverted or out-of-window turn.
        const absStart = clamp(tStartMs + seg.startMs, tStartMs, tEndMs);
        const absEnd = clamp(tStartMs + seg.endMs, absStart, tEndMs);
        out.push({
          id: `u${++this.windowIndex}`,
          speaker: mapSpeaker(seg.speaker),
          text: seg.text.trim(),
          tStartMs: absStart,
          tEndMs: absEnd,
        });
      }
    }
    for (const u of out) {
      this.utterances.push(u);
      // DS1 — register so the findings pass can cite it (citation gate).
      this.caseStore.registerUtterance(u.id);
    }
    return out;
  }

  private cumulativeTranscript(): string {
    return this.utterances
      .map((u) => u.text)
      .filter((t) => t.length > 0)
      .join(' ');
  }

  /**
   * Rebuild the structured note (Pass 2) on the cumulative transcript and
   * run the deterministic flags. `isFinal` emits the closing `final` event
   * (note + drafted Rx + orders) instead of an incremental `note`.
   */
  private async runNote(isFinal: boolean): Promise<void> {
    const transcript = this.cumulativeTranscript();
    if (transcript.length === 0) {
      if (isFinal) this.emitFinalFromLatest();
      return;
    }

    // Sprint 74 — debounce the interim note: run the first one immediately
    // (the doctor sees a note early), then only once ≥ noteRefreshMs of NEW
    // speech has accumulated. The finalize run is never debounced.
    const transcriptEndMs = bytesToMs(this.flushedBytes);
    const hasLatest =
      this.vertical === 'THERAPIST' ? this.latestTherapyNote !== null : this.latestNote !== null;
    if (
      !isFinal &&
      hasLatest &&
      transcriptEndMs - this.lastNoteTranscriptEndMs < this.noteRefreshMs
    ) {
      return;
    }

    // Interim refreshes go to the cheap backend; the authoritative finalize
    // note (what gets signed) uses the full-quality one. pass2Final is
    // optional — absent (mock/dev) everything runs on pass2.
    const backend = isFinal
      ? (this.backends.pass2Final ?? this.backends.pass2)
      : this.backends.pass2;

    const t0 = Date.now();
    const pass2 = await backend.run({
      sessionId: this.sessionId,
      transcript,
      speakerSegments: this.segments,
      kind: this.vertical === 'DOCTOR' ? 'TREATMENT' : this.sessionKind,
      modality: this.vertical === 'DOCTOR' ? null : this.sessionModality,
      vertical: this.vertical,
      clientContext: {},
    });
    this.meter.recordNote(pass2.callLog, Date.now() - t0);
    this.lastNoteTranscriptEndMs = transcriptEndMs;

    // Sprint TS1 — therapist branch: a SOAP/intake note (no meds/orders/Rx),
    // emitted on the therapyNote / therapyFinal wire events; the note's own
    // riskFlags drive a free live safety rail (emitTherapyRisk).
    if (this.vertical === 'THERAPIST') {
      const out = pass2.output;
      let kind: SessionKind;
      let tnote: TherapyNoteV1 | IntakeNoteV1;
      if (out.kind === 'INTAKE') {
        kind = 'INTAKE';
        tnote = out.intakeNote;
      } else if (out.kind === 'TREATMENT' || out.kind === 'REVIEW') {
        kind = out.kind;
        tnote = out.therapyNote;
      } else {
        // MEDICAL — never expected for a therapist; keep the last good note.
        console.warn(
          `[live-gateway] therapist Pass 2 returned a non-therapy note (kind=${out.kind}) ` +
            `for sess=${this.sessionId}; ignoring. Check the Pass-2 backend vertical branch.`,
        );
        if (isFinal) this.emitFinalFromLatest();
        return;
      }
      this.latestTherapyNote = tnote;
      this.latestTherapyKind = kind;
      this.emitTherapyRisk(tnote);
      if (isFinal) {
        if (this.finalEmitted) return;
        this.finalEmitted = true;
        this.emit({
          type: 'therapyFinal',
          kind,
          note: tnote,
          transcript: this.cumulativeTranscript(),
        });
        return;
      }
      const tjson = JSON.stringify(tnote);
      if (tjson !== this.lastNoteJson) {
        this.lastNoteJson = tjson;
        this.emit({ type: 'therapyNote', kind, note: tnote });
      }
      return;
    }

    if (pass2.output.kind !== 'MEDICAL') {
      // Defensive — DOCTOR always MEDICAL. Fall back to whatever we had.
      if (isFinal) this.emitFinalFromLatest();
      return;
    }
    const note = pass2.output.encounterNote;
    this.latestNote = note;
    this.latestMedications = pass2.output.medications;
    this.latestOrders = pass2.output.orders;

    if (isFinal) {
      if (this.finalEmitted) return;
      this.finalEmitted = true;
      this.emit({
        type: 'final',
        note,
        medications: this.latestMedications,
        orders: this.latestOrders,
        rxPad: this.assembleRx(), // DS5 — the finalized signable pad
      });
      return;
    }

    const noteJson = JSON.stringify(note);
    if (noteJson !== this.lastNoteJson) {
      this.lastNoteJson = noteJson;
      this.emit({ type: 'note', partial: note });
    }

    // DOC-2 — the deterministic red-flag + interaction checks used to live
    // HERE, below the Sprint-74 note debounce, so they only fired every
    // ~noteRefreshMs and NEVER on the finalize path. They now run per window
    // (and once more at finalize) via runDeterministicChecks(); see
    // processWindow + finalizeWork.

    // Sprint DS5 — the Rx pad assembling live. Emit only when it changed.
    const rxPad = this.assembleRx();
    const rxJson = JSON.stringify(rxPad);
    if (rxJson !== this.lastRxJson) {
      this.lastRxJson = rxJson;
      this.emit({ type: 'rxDraft', rxPad });
    }
  }

  /**
   * DOC-2 — the deterministic (regex/table, ~0 cost) safety engine: red-flag
   * detection over the cumulative transcript + latest note, and drug-
   * interaction checks over the drafted meds. Runs EVERY window and once at
   * finalize — decoupled from the note-refresh debounce — so a red flag in the
   * last seconds of a consult still reaches the before-you-close gate. Every
   * gap is deduped by message, so re-running per window is cheap + idempotent.
   */
  private runDeterministicChecks(): void {
    // Sprint TS1 — the medical red-flag table + drug-interaction checks don't
    // apply to therapy; its safety rail is the note's own riskFlags (emitTherapyRisk).
    if (this.vertical === 'THERAPIST') return;
    const transcript = this.cumulativeTranscript();
    if (transcript.length === 0) return;
    for (const gap of detectGaps(transcript, this.latestNote, this.specialty)) {
      if (this.seenGaps.has(gap.message)) continue;
      this.seenGaps.add(gap.message);
      this.emit({ type: 'gap', gap: gap satisfies EncounterGap });
    }
    // DOC-3 — cross-visit interaction check. Include the patient's confirmed
    // active meds (seeded into the CaseState at consult start) alongside the
    // meds drafted today, so a standing warfarin + ibuprofen prescribed now
    // flags. Interactions that already existed among the prior regimen alone
    // aren't introduced by this consult, so they're excluded to avoid alert
    // fatigue.
    const priorMeds = this.caseStore.snapshot.patient.activeMeds;
    const draftedMeds = this.latestMedications.map((m) => m.drug);
    const priorOnly = new Set(checkInteractions(priorMeds).map((i) => `${i.drugA}|${i.drugB}`));
    for (const interaction of checkInteractions([...priorMeds, ...draftedMeds])) {
      if (priorOnly.has(`${interaction.drugA}|${interaction.drugB}`)) continue;
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

  /** Sprint DS5 — assemble the current Rx pad from the note + meds + context. */
  private assembleRx(): RxPadV1 {
    return assembleRxPad({
      patient: this.caseStore.snapshot.patient,
      note: this.latestNote,
      medications: this.latestMedications,
      orders: this.latestOrders,
      voiceCommands: this.voiceCommands,
    });
  }

  /**
   * Sprint TS1 — the free live safety rail for therapy: surface the note's
   * own riskFlags as a RED_FLAG gap (deduped) when severity is meaningful. No
   * new LLM pass — Pass 2 already scores riskFlags on every interim note.
   */
  private emitTherapyRisk(note: TherapyNoteV1 | IntakeNoteV1): void {
    const rf = note.riskFlags;
    if (!rf || rf.severity === 'none') return;
    const message =
      rf.details?.trim() ||
      (rf.indicators.length > 0
        ? `Risk indicators: ${rf.indicators.join('; ')}`
        : 'Elevated risk detected — assess safety.');
    const key = `risk:${rf.severity}:${message}`;
    if (this.seenGaps.has(key)) return;
    this.seenGaps.add(key);
    const severity: 'info' | 'warn' | 'critical' =
      rf.severity === 'critical' || rf.severity === 'high'
        ? 'critical'
        : rf.severity === 'medium'
          ? 'warn'
          : 'info';
    this.emit({
      type: 'gap',
      gap: { kind: 'RED_FLAG', severity, message } satisfies EncounterGap,
    });
  }

  /** Doctor ended the consult: flush the tail, close the note, report. */
  async finalize(): Promise<void> {
    if (this.stopped) return;
    this.stopAudio(); // sets `stopped` → any in-flight pump loop exits after its window
    await this.waitIdle();
    this.emit({ type: 'status', state: 'finalizing' });
    try {
      // A slow or hung final note (Pass 2 on Vertex) must never trap the
      // doctor on "Finishing…". Cap the finalize work; on overrun, fall back
      // to the last good live note so `final` + `done` ALWAYS fire.
      await Promise.race([
        this.finalizeWork(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('finalize budget exceeded')), 25_000),
        ),
      ]);
    } catch (err) {
      console.error('[live-gateway] finalize failed:', (err as Error).message);
      this.emitFinalFromLatest();
    } finally {
      this.emit({ type: 'meter', summary: this.meterSummary() });
      this.emit({ type: 'status', state: 'done' });
    }
  }

  /** The bounded finalize body: last-window transcription → reasoning → note. */
  private async finalizeWork(): Promise<void> {
    // Transcribe whatever remains as the final window (may be short).
    if (this.pending.length > 0) {
      const tail = this.pending;
      const durationMs = bytesToMs(tail.length);
      const consumed = tail.length;
      this.pending = Buffer.alloc(0);
      const tStartMs = bytesToMs(this.flushedBytes);
      const t0 = Date.now();
      const pass1 = await this.backends.pass1.run({
        sessionId: this.sessionId,
        audioBytes: tail,
        durationMs,
        vertical: this.vertical, // Sprint TS1 — DOCTOR or THERAPIST
      });
      this.meter.recordTranscribe(pass1.callLog, Date.now() - t0);
      this.meter.markWindow();
      this.flushedBytes += consumed;
      const tEndMs = bytesToMs(this.flushedBytes);
      // Anti-hallucination (TS-fix): skip a silent tail window — no blank
      // utterance, no hallucinated closing line.
      if (pass1.output.transcript.trim().length > 0) {
        // Sprint TS-B1 — per-segment utterances at the tail too.
        const utterances = this.commitUtterances(
          pass1.output.transcript,
          pass1.output.speakerSegments,
          tStartMs,
          tEndMs,
        );
        this.recordSpeechToTranscript(tStartMs);
        for (const utterance of utterances) {
          this.emit({
            type: 'transcript',
            delta: {
              text: utterance.text,
              isFinal: true,
              speaker: utterance.speaker,
              startMs: utterance.tStartMs,
              endMs: utterance.tEndMs,
            },
          });
          this.emit({ type: 'utterance', utterance });
          this.reasoningScheduler.enqueue(utterance);
        }
      }
    }
    // Sprint DS2 / TS5 — run the reasoning engine over anything the scheduler
    // was still coalescing so the closing snapshot reflects the whole consult.
    if (this.reasoningScheduler.hasPending) {
      const pending = this.reasoningScheduler.flush();
      if (this.vertical === 'THERAPIST') await this.runTherapyReasoning(pending);
      else await this.runReasoning(pending);
    }
    // DOC-2 — run the deterministic checks over the FULL transcript (incl. the
    // tail window just committed above) BEFORE the note's `final` event, so a
    // red flag in the closing seconds reaches the before-you-close gate.
    this.runDeterministicChecks();
    await this.runNote(true);
  }

  private meterSummary() {
    return this.meter.summary(this.sessionId, this.backends.backend, Date.now() - this.startedAtMs);
  }

  /**
   * DOC-9 — record the lived speech→transcript latency for a window whose
   * speech began at audio-offset `tStartMs`. The window's first speech was
   * spoken at wall-clock ≈ captureStartMs + tStartMs; `now − that` includes
   * the window-wait + pump + Pass-1 call — the honest number the ≤2s target
   * should be judged against.
   */
  private recordSpeechToTranscript(tStartMs: number): void {
    if (this.captureStartMs === 0) return; // no audio captured — nothing to time
    this.meter.recordSpeechToTranscript(Date.now() - (this.captureStartMs + tStartMs));
  }

  /** Wait for any in-flight `pump()` window to finish before finalizing. */
  private async waitIdle(): Promise<void> {
    // Bounded: a stuck in-flight window must never block finalize forever.
    const deadline = Date.now() + 4_000;
    while (this.busy && Date.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  private emitFinalFromLatest(): void {
    if (this.finalEmitted) return;
    // Sprint TS1 — therapist fallback final (on a finalize timeout/failure).
    if (this.vertical === 'THERAPIST') {
      if (!this.latestTherapyNote) {
        // No note ever built (Pass 2 empty/blocked/errored every window). We
        // cannot fabricate a clinical note, but the client MUST NOT hang: it
        // treats the `done` status that always follows as a "no note" terminal
        // and offers recovery. Log so the cause is diagnosable.
        console.warn(
          `[live-gateway] therapist finalize: no note was built for sess=${this.sessionId} ` +
            `(utterances=${this.utterances.length}); emitting no therapyFinal — client shows recovery.`,
        );
        return;
      }
      this.finalEmitted = true;
      this.emit({
        type: 'therapyFinal',
        kind: this.latestTherapyKind,
        note: this.latestTherapyNote,
        transcript: this.cumulativeTranscript(),
      });
      return;
    }
    if (!this.latestNote) return;
    this.finalEmitted = true;
    this.emit({
      type: 'final',
      note: this.latestNote,
      medications: this.latestMedications,
      orders: this.latestOrders,
      rxPad: this.assembleRx(),
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
    this.pending = Buffer.alloc(0);
    this.totalBytes = 0;
  }
}

/** Map a note's recorded vitals to the template vital ids (bp / hr / weight). */
function presentVitalIds(note: MedicalEncounterNoteV1 | null): string[] {
  const v = note?.vitals;
  if (!v) return [];
  const ids: string[] = [];
  if (v.bpSystolic && v.bpDiastolic) ids.push('bp');
  if (v.heartRateBpm) ids.push('hr');
  if (v.weightKg) ids.push('weight');
  return ids;
}

function mapSpeaker(speaker: SpeakerSegment['speaker'] | undefined): Utterance['speaker'] {
  if (speaker === 'therapist') return 'doctor';
  if (speaker === 'client') return 'patient';
  return 'unknown';
}

/** Map a drug-interaction severity to the EncounterGap severity scale. */
function interactionSeverity(s: InteractionSeverity): 'info' | 'warn' | 'critical' {
  if (s === 'contraindicated' || s === 'major') return 'critical';
  if (s === 'moderate') return 'warn';
  return 'info';
}
