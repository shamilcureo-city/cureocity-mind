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
      const created = await prisma.transcriptSegment.create({
        data: {
          sessionId: args.sessionId,
          audioChunkId: chunk.id,
          chunkIndex: args.chunkIndex,
          status: 'TRANSCRIBING',
          startedAt: new Date(),
          attempts: 1,
        },
        select: { id: true },
      });
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
    result = await router.pass1({
      sessionId: args.sessionId,
      audioBytes: Buffer.from(chunk.bytes),
      durationMs: chunk.durationMs,
      ...(hints && { hints }),
    });
  } catch (e) {
    // The backend's own try/catch returns an ERROR callLog rather than
    // throwing in normal failure modes; this is the path for unexpected
    // exceptions before the call site.
    await markSegmentFailed(segmentId, (e as Error).message);
    return { status: 'failed', reason: (e as Error).message };
  }

  // 4. Persist the Gemini call log for cost rollups even on per-chunk runs.
  await persistCallLog(result.callLog);
  recordGeminiCall({
    pass: result.callLog.pass,
    status: result.callLog.status,
    region: result.callLog.region,
    durationMs: result.callLog.latencyMs,
  });

  if (result.callLog.status !== 'SUCCESS') {
    const reason = result.callLog.errorMessage ?? 'vertex-error';
    await markSegmentFailed(segmentId, reason);
    return { status: 'failed', reason };
  }

  // 5. Persist the per-window transcript + diarization. Timestamps inside
  //    speakerSegments / affectFeatures stay window-relative; the
  //    orchestrator offsets them by cumulative chunk durations at assembly.
  await prisma.transcriptSegment.update({
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

  await writeAudit({
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
  });

  return {
    status: 'completed',
    transcriptChars: result.output.transcript.length,
    latencyMs: result.callLog.latencyMs,
  };
}

async function markSegmentFailed(segmentId: string, reason: string): Promise<void> {
  const updated = await prisma.transcriptSegment.update({
    where: { id: segmentId },
    data: {
      status: 'FAILED',
      errorMessage: reason,
      completedAt: new Date(),
    },
    select: { sessionId: true, chunkIndex: true, attempts: true },
  });
  await writeAudit({
    actorType: 'SYSTEM',
    action: 'TRANSCRIPT_SEGMENT_FAILED',
    targetType: 'TranscriptSegment',
    targetId: segmentId,
    metadata: {
      sessionId: updated.sessionId,
      chunkIndex: updated.chunkIndex,
      attempts: updated.attempts,
      reason,
    },
  });
}

async function persistCallLog(log: GeminiCallLogData): Promise<void> {
  await prisma.geminiCallLog.create({
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
      ...(log.errorMessage !== undefined && { errorMessage: log.errorMessage }),
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
    for (const speaker of seg.speakerSegments) {
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
