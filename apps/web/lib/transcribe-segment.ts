import { Prisma, type TranscriptSegmentStatus } from '@prisma/client';
import {
  type GeminiCallLogData,
  type Pass1Output,
  type SpeakerSegment,
  type AffectFeature,
} from '@cureocity/llm';
import { recordGeminiCall } from '@cureocity/observability/metrics';
import { writeAudit } from './audit';
import { modelRouter } from './llm';
import { prisma } from './prisma';
import { assertCurrentScribeAuthority } from './scribe-authority';
import { ClientPhiWriteForbiddenError, withActiveSessionPhiWrite } from './phi-write-lock';
import { compactPassError } from './pass-error';

/**
 * Sprint 57 — transcribe-on-arrival.
 *
 * The chunk-upload route (apps/web/app/api/v1/audio/chunks/upload/route.ts)
 * fires this via `after()` once a fresh AudioChunk row commits, so each 30s
 * window of audio gets transcribed while the next chunk is still being
 * recorded. By the time the therapist hits "End session", the transcript is
 * effectively done — the orchestrator (note-orchestrator.ts) only has to
 * assemble + run Pass 2.
 *
 * Hobby-friendly:
 *   one chunk ≈ 30s audio ≈ ~3-5s Gemini Flash call ≈ ~8s end-to-end with
 *   the 1-3s upload that preceded it. Comfortably inside the 60s function
 *   ceiling, with room for one bounded retry on a transient Vertex blip.
 *
 * Idempotency:
 *   - Re-running for the same (sessionId, chunkIndex) short-circuits when a
 *     COMPLETED segment exists.
 *   - A claim step flips PENDING/FAILED rows to TRANSCRIBING so two parallel
 *     callers (upload after() + orchestrator backstop) don't double-bill.
 *     Rare race may double-bill once; acceptable trade-off against a more
 *     complex distributed lock.
 */

export interface TranscribeChunkArgs {
  sessionId: string;
  chunkIndex: number;
  /// Backed off retries on Vertex blips. Optional override mainly for tests.
  maxAttempts?: number;
  /// REL-2 — the End-session backstop is a window's LAST chance before the
  /// note is assembled. When true, it ignores the attempts cap (a maxed-out
  /// row would otherwise be dropped silently). It always reclaims a stale
  /// TRANSCRIBING row regardless of this flag.
  fromBackstop?: boolean;
}

/// REL-2 — a TRANSCRIBING row older than this was almost certainly orphaned by
/// a reaped Vercel `after()` callback (the claim never reached COMPLETED or
/// FAILED). Reclaim it rather than skipping it as "already-in-flight" forever.
const STALE_TRANSCRIBING_MS = 3 * 60_000;

export type TranscribeChunkResult =
  | { status: 'completed'; transcriptChars: number; latencyMs: number }
  | { status: 'failed'; reason: string }
  | { status: 'skipped'; reason: string };

const DEFAULT_MAX_ATTEMPTS = 2;

export async function transcribeChunkInline(
  args: TranscribeChunkArgs,
): Promise<TranscribeChunkResult> {
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // 1. Load the chunk row. Validate we have something to transcribe.
  const chunk = await prisma.audioChunk.findUnique({
    where: { sessionId_chunkIndex: { sessionId: args.sessionId, chunkIndex: args.chunkIndex } },
    select: {
      id: true,
      durationMs: true,
      sizeBytes: true,
      bytes: true,
      session: {
        select: {
          id: true,
          psychologistId: true,
          client: { select: { spokenLanguages: true } },
          // DOC-6 — pick the Pass-1 transcription persona by vertical.
          psychologist: { select: { vertical: true } },
        },
      },
    },
  });
  if (!chunk) {
    return { status: 'skipped', reason: 'audio-chunk-missing' };
  }
  if (!chunk.bytes || chunk.bytes.byteLength === 0) {
    return { status: 'skipped', reason: 'audio-chunk-empty' };
  }

  // 2. Claim the segment row. Concurrent uploaders + the orchestrator
  //    backstop may both reach this point; only one should actually call
  //    Gemini. updateMany on a PENDING/FAILED status doubles as the lock.
  const existing = await prisma.transcriptSegment.findUnique({
    where: { audioChunkId: chunk.id },
    select: { id: true, status: true, attempts: true, startedAt: true },
  });

  const staleCutoff = new Date(Date.now() - STALE_TRANSCRIBING_MS);
  const isStaleInFlight =
    existing?.status === 'TRANSCRIBING' &&
    existing.startedAt !== null &&
    existing.startedAt < staleCutoff;

  let segmentId: string;
  if (!existing) {
    try {
      const created = await withActiveSessionPhiWrite(
        prisma,
        args.sessionId,
        chunk.session.psychologistId,
        (tx) =>
          tx.transcriptSegment.create({
            data: {
              sessionId: args.sessionId,
              audioChunkId: chunk.id,
              chunkIndex: args.chunkIndex,
              status: 'TRANSCRIBING',
              startedAt: new Date(),
              attempts: 1,
            },
            select: { id: true },
          }),
        { allowedStatuses: ['IN_PROGRESS', 'COMPLETED'] },
      );
      segmentId = created.id;
    } catch (e) {
      // P2002 = another caller raced us to the create. Re-fetch and let
      // that caller do the work; we exit.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { status: 'skipped', reason: 'race-lost-create' };
      }
      throw e;
    }
  } else if (existing.status === 'COMPLETED') {
    return { status: 'skipped', reason: 'already-completed' };
  } else if (existing.status === 'TRANSCRIBING' && !isStaleInFlight) {
    // A genuinely in-flight row — let the other caller finish. Only a STALE
    // one (reaped after()) falls through to be reclaimed below (REL-2).
    return { status: 'skipped', reason: 'already-in-flight' };
  } else if (existing.attempts >= maxAttempts && !args.fromBackstop) {
    // The backstop is the last chance before assembly, so it ignores the cap.
    return { status: 'skipped', reason: 'max-attempts-reached' };
  } else {
    // Claim a PENDING / FAILED row — OR a STALE TRANSCRIBING row orphaned by a
    // reaped after() (REL-2) — by atomically advancing the status. The
    // startedAt guard on the TRANSCRIBING arm keeps a genuinely in-flight row
    // safe from a concurrent reclaim.
    const claimed = await prisma.transcriptSegment.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] satisfies TranscriptSegmentStatus[] } },
          { status: 'TRANSCRIBING', startedAt: { lt: staleCutoff } },
        ],
      },
      data: {
        status: 'TRANSCRIBING',
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return { status: 'skipped', reason: 'race-lost-claim' };
    }
    segmentId = existing.id;
  }

  // 3. Call Pass 1 on this window only. The existing backend accepts any
  //    length — we just hand it the one chunk's bytes.
  const router = modelRouter();
  const hints =
    Array.isArray(chunk.session.client.spokenLanguages) &&
    chunk.session.client.spokenLanguages.length > 0
      ? { spokenLanguageHints: chunk.session.client.spokenLanguages }
      : undefined;

  let result: { output: Pass1Output; callLog: GeminiCallLogData };
  try {
    await assertCurrentScribeAuthority(args.sessionId, {
      psychologistId: chunk.session.psychologistId,
      source: args.fromBackstop
        ? 'transcribeChunkBackstopBeforeModel'
        : 'transcribeChunkBeforeModel',
    });
  } catch {
    zeroAudio(chunk.bytes);
    await markSegmentFailed(
      args.sessionId,
      chunk.session.psychologistId,
      segmentId,
      'authorization-denied',
    );
    return { status: 'failed', reason: 'authorization-denied' };
  }
  const modelAudio = Buffer.from(chunk.bytes);
  try {
    result = await router.pass1({
      sessionId: args.sessionId,
      audioBytes: modelAudio,
      durationMs: chunk.durationMs,
      ...(hints && { hints }),
      // DOC-6 — a DICTATE/UPLOAD doctor consult gets the medical prompt too.
      vertical: chunk.session.psychologist.vertical === 'DOCTOR' ? 'DOCTOR' : 'THERAPIST',
    });
  } catch (e) {
    // The backend's own try/catch returns an ERROR callLog rather than
    // throwing in normal failure modes; this is the path for unexpected
    // exceptions before the call site.
    await markSegmentFailed(
      args.sessionId,
      chunk.session.psychologistId,
      segmentId,
      (e as Error).message,
    );
    return { status: 'failed', reason: (e as Error).message };
  } finally {
    // The router receives this copy by reference. Clear it on every exit so a
    // denied or failed background call cannot retain plaintext audio in memory.
    zeroAudio(modelAudio);
  }

  try {
    await assertCurrentScribeAuthority(args.sessionId, {
      psychologistId: chunk.session.psychologistId,
      source: args.fromBackstop
        ? 'transcribeChunkBackstopBeforePersistence'
        : 'transcribeChunkBeforePersistence',
    });
  } catch {
    zeroAudio(chunk.bytes);
    result.output.transcript = '';
    result.output.speakerSegments = [];
    result.output.affectFeatures = [];
    await markSegmentFailed(
      args.sessionId,
      chunk.session.psychologistId,
      segmentId,
      'authorization-denied',
    );
    return { status: 'failed', reason: 'authorization-denied' };
  }

  if (result.callLog.status !== 'SUCCESS') {
    const reason = result.callLog.errorMessage ?? 'vertex-error';
    await markSegmentFailed(
      args.sessionId,
      chunk.session.psychologistId,
      segmentId,
      reason,
      result.callLog,
    );
    recordGeminiCall({
      pass: result.callLog.pass,
      status: result.callLog.status,
      region: result.callLog.region,
      durationMs: result.callLog.latencyMs,
    });
    return { status: 'failed', reason };
  }

  // 5. Persist the per-window transcript + diarization. Timestamps inside
  //    speakerSegments / affectFeatures stay window-relative; the
  //    orchestrator offsets them by cumulative chunk durations at assembly.
  // PASS_1_SEGMENT_COMPLETED — Pass 1/network work is already finished. Take
  // the Client lock only for this short persistence group, then recheck the
  // Session immediately before committing transcript PHI.
  await withActiveSessionPhiWrite(
    prisma,
    args.sessionId,
    chunk.session.psychologistId,
    async (tx) => {
      // PASS_1_CALL_LOG — session ownership/state is reread while the Client
      // lock is held; erasure cannot leave a delayed model log behind.
      await persistCallLog(result.callLog, tx);
      await tx.transcriptSegment.update({
        where: { id: segmentId },
        data: {
          status: 'COMPLETED',
          transcript: result.output.transcript,
          speakerSegments: result.output.speakerSegments as unknown as Prisma.InputJsonValue,
          affectFeatures: result.output.affectFeatures as unknown as Prisma.InputJsonValue,
          detectedLanguages: result.output.detectedLanguages,
          model: result.callLog.model,
          region: result.callLog.region,
          costInr: new Prisma.Decimal(result.callLog.costInr),
          latencyMs: result.callLog.latencyMs,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await writeAudit(
        {
          actorType: 'SYSTEM',
          actorPsychologistId: chunk.session.psychologistId,
          action: 'TRANSCRIPT_SEGMENT_TRANSCRIBED',
          targetType: 'TranscriptSegment',
          targetId: segmentId,
          metadata: {
            sessionId: args.sessionId,
            chunkIndex: args.chunkIndex,
            audioChunkId: chunk.id,
            transcriptChars: result.output.transcript.length,
            detectedLanguages: result.output.detectedLanguages,
            model: result.callLog.model,
            latencyMs: result.callLog.latencyMs,
            costInr: result.callLog.costInr,
          },
        },
        tx,
      );
    },
    { allowedStatuses: ['IN_PROGRESS', 'COMPLETED'] },
  );
  recordGeminiCall({
    pass: result.callLog.pass,
    status: result.callLog.status,
    region: result.callLog.region,
    durationMs: result.callLog.latencyMs,
  });

  return {
    status: 'completed',
    transcriptChars: result.output.transcript.length,
    latencyMs: result.callLog.latencyMs,
  };
}

function zeroAudio(bytes: Uint8Array | null): void {
  bytes?.fill(0);
}

async function markSegmentFailed(
  sessionId: string,
  psychologistId: string,
  segmentId: string,
  reason: string,
  callLog?: GeminiCallLogData,
): Promise<void> {
  try {
    // PASS_1_SEGMENT_FAILED — failure details can contain clinical context, so
    // serialize their persistence against erasure just like successful text.
    await withActiveSessionPhiWrite(
      prisma,
      sessionId,
      psychologistId,
      async (tx) => {
        // PASS_1_CALL_LOG — failed call logs carry bounded errors and are PHI-
        // linked artifacts, so persist them under the same erasure lock.
        if (callLog) await persistCallLog(callLog, tx);
        const safeReason = compactPassError(reason);
        const updated = await tx.transcriptSegment.update({
          where: { id: segmentId },
          data: {
            status: 'FAILED',
            errorMessage: safeReason,
            completedAt: new Date(),
          },
          select: { sessionId: true, chunkIndex: true, attempts: true },
        });
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'TRANSCRIPT_SEGMENT_FAILED',
            targetType: 'TranscriptSegment',
            targetId: segmentId,
            metadata: {
              sessionId: updated.sessionId,
              chunkIndex: updated.chunkIndex,
              attempts: updated.attempts,
              reason: safeReason,
            },
          },
          tx,
        );
      },
      { allowedStatuses: ['IN_PROGRESS', 'COMPLETED'] },
    );
  } catch (error) {
    if (!(error instanceof ClientPhiWriteForbiddenError)) throw error;
    // Erasure won the Client lock. Do not recreate a FAILED marker or retain
    // delayed error details after the terminal deletion state.
  }
}

async function persistCallLog(
  log: GeminiCallLogData,
  tx: Pick<Prisma.TransactionClient, 'geminiCallLog'>,
): Promise<void> {
  await tx.geminiCallLog.create({
    data: {
      ...(log.sessionId !== undefined && { sessionId: log.sessionId }),
      pass: log.pass,
      model: log.model,
      region: log.region,
      promptVersion: log.promptVersion,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costInr: new Prisma.Decimal(log.costInr),
      latencyMs: log.latencyMs,
      status: log.status,
      ...(log.errorMessage !== undefined && { errorMessage: compactPassError(log.errorMessage) }),
    },
  });
}

// ============================================================================
// Assembly — used by the orchestrator at "End session" to stitch the
// per-window outputs into the same shape Pass 1 used to produce in a single
// shot. Speaker / affect timestamps are window-relative; we offset them by
// the cumulative duration of prior chunks so they line up with the global
// session timeline.
// ============================================================================

export interface AssembledTranscript {
  transcript: string;
  speakerSegments: SpeakerSegment[];
  affectFeatures: AffectFeature[];
  detectedLanguages: string[];
  totalCostInr: number;
  totalLatencyMs: number;
  segmentCount: number;
}

export interface AssemblyInput {
  chunkIndex: number;
  durationMs: number;
  transcript: string;
  speakerSegments: SpeakerSegment[];
  affectFeatures: AffectFeature[];
  detectedLanguages: string[];
  costInr: number;
  latencyMs: number;
}

/**
 * Guarantee that transcript text is never stranded outside the speaker timeline.
 *
 * Diarization is best-effort; the transcript is not. Pass 1 can return text for
 * a window and still hand back an EMPTY speakerSegments array — a quiet window,
 * a single voice, or a model that simply didn't diarize. Assembly used to keep
 * the text and drop that window from the timeline, which produced a NoteDraft
 * holding a full transcript and zero segments.
 *
 * That looked survivable and wasn't. Pass 2 reads `transcript`, so the note came
 * out fine — but Pass 3 builds its ENTIRE transcript block from speakerSegments
 * (see vertex-clinical.backend.ts), so the clinical brief had nothing to read.
 * The therapist got a note and a dead AI copilot: "No speaker segments
 * available — Pass 1 output is incomplete."
 *
 * So an undiarized window becomes ONE `unknown` segment carrying its text.
 * `unknown` is a first-class speaker in both SpeakerSegmentSchema and Pass 3's
 * supporting-quote schema, so a quote pulled from it is honestly unattributed
 * rather than falsely credited to the client — which is the failure mode that
 * would actually matter clinically.
 */
export function coverTranscriptWithSegments(args: {
  transcript: string;
  segments: SpeakerSegment[];
  startMs: number;
  endMs: number;
}): SpeakerSegment[] {
  if (args.segments.length > 0) return args.segments;
  const text = args.transcript.trim();
  if (text.length === 0) return [];
  return [
    {
      speaker: 'unknown',
      startMs: args.startMs,
      // endMs is a positive int in the schema, and a chunk with an unknown or
      // zero duration would otherwise fail validation downstream.
      endMs: Math.max(args.endMs, args.startMs + 1),
      text,
    },
  ];
}

export function assembleSegments(segments: AssemblyInput[]): AssembledTranscript {
  const ordered = [...segments].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const transcriptParts: string[] = [];
  const speakerSegments: SpeakerSegment[] = [];
  const affectFeatures: AffectFeature[] = [];
  const languageOrder: string[] = [];
  const languageSeen = new Set<string>();
  let cumulativeOffsetMs = 0;
  let totalCostInr = 0;
  let totalLatencyMs = 0;

  for (const seg of ordered) {
    if (seg.transcript.length > 0) {
      transcriptParts.push(seg.transcript);
    }
    // Window-relative first, then offset — so a synthesised cover segment
    // spans exactly this window rather than the whole session.
    const covered = coverTranscriptWithSegments({
      transcript: seg.transcript,
      segments: seg.speakerSegments,
      startMs: 0,
      endMs: seg.durationMs,
    });
    for (const speaker of covered) {
      speakerSegments.push({
        ...speaker,
        startMs: speaker.startMs + cumulativeOffsetMs,
        endMs: speaker.endMs + cumulativeOffsetMs,
      });
    }
    for (const affect of seg.affectFeatures) {
      affectFeatures.push({
        ...affect,
        startMs: affect.startMs + cumulativeOffsetMs,
        endMs: affect.endMs + cumulativeOffsetMs,
      });
    }
    for (const lang of seg.detectedLanguages) {
      if (!languageSeen.has(lang)) {
        languageSeen.add(lang);
        languageOrder.push(lang);
      }
    }
    cumulativeOffsetMs += seg.durationMs;
    totalCostInr += seg.costInr;
    totalLatencyMs += seg.latencyMs;
  }

  return {
    transcript: transcriptParts.join(' ').replace(/\s+/g, ' ').trim(),
    speakerSegments,
    affectFeatures,
    detectedLanguages: languageOrder,
    totalCostInr,
    totalLatencyMs,
    segmentCount: ordered.length,
  };
}
