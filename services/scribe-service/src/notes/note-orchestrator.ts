import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type NoteRiskSeverity as PrismaRiskSeverity } from '@prisma/client';
import {
  type IModelRouter,
  type Pass1Output,
  computeCostInr,
  estimateAudioInputTokens,
  FLASH_PRICING,
  PRO_PRICING,
} from '@cureocity/llm';
import type { IStorageClient } from '@cureocity/storage';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_CLIENT } from '../storage/storage.module';
import { MODEL_ROUTER } from '../llm/llm.module';
import { CostCircuitOpenError, CostGuardService } from '../cost/cost-guard.service';

/**
 * Drives the two-pass note-generation pipeline for one Session.
 * Invoked by NoteGenerationProcessor (BullMQ worker) or directly by
 * tests/integration in NOTE_QUEUE_BACKEND=sync mode.
 *
 * Workflow:
 *   1. upsert NoteDraft to IN_PROGRESS
 *   2. fetch + concatenate audio chunks
 *   3. Pass 1 (Flash, asia-south1) → transcript + segments + affect
 *   4. persist Pass 1 outputs, update totalCostInr
 *   5. Pass 2 (Pro, global) → TherapyNoteV1
 *   6. persist content + status=COMPLETED, update totalCostInr
 *   7. audit NOTE_DRAFT_CREATED
 *   8. if risk severity high/critical → audit CRISIS_FLAG_RAISED (gap G3
 *      partial resolution — surfaces to therapist; auto-text iCall etc.
 *      requires Sharafath sign-off and lives in a later sprint)
 *
 * On error at any step: NoteDraft.status=FAILED, errorMessage set,
 * GeminiCallLog still written for the failed call.
 */
@Injectable()
export class NoteOrchestrator {
  private readonly logger = new Logger(NoteOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly costGuard: CostGuardService,
    @Inject(STORAGE_CLIENT) private readonly storage: IStorageClient,
    @Inject(MODEL_ROUTER) private readonly router: IModelRouter,
  ) {}

  async run(sessionId: string): Promise<void> {
    this.logger.log(`Note generation start: session=${sessionId}`);

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { client: true },
    });
    if (!session) {
      this.logger.error(`Session not found for note generation: ${sessionId}`);
      return;
    }

    // 1. Upsert draft → IN_PROGRESS
    const draft = await this.prisma.noteDraft.upsert({
      where: { sessionId },
      update: { status: 'IN_PROGRESS', errorMessage: null },
      create: { sessionId, status: 'IN_PROGRESS' },
    });

    try {
      // 2. Fetch + concatenate audio
      const { audioBytes, durationMs } = await this.fetchAudio(sessionId);
      if (audioBytes.byteLength === 0) {
        throw new Error('No audio chunks uploaded for session');
      }

      // 3a. Cost circuit-breaker pre-check for Pass 1 (gap G6).
      // Estimate cost = audio tokens * Flash input + small output buffer.
      const pass1Estimate = computeCostInr(
        estimateAudioInputTokens(durationMs),
        1_000,
        FLASH_PRICING,
      );
      await this.costGuard.checkBeforeCall({
        sessionId,
        psychologistId: session.psychologistId,
        estimatedCostInr: pass1Estimate,
      });

      // 3b. Pass 1
      const pass1 = await this.router.pass1({ sessionId, audioBytes, durationMs });
      const pass1Cost = new Prisma.Decimal(pass1.callLog.costInr);

      // 4. Persist Pass 1
      await this.prisma.noteDraft.update({
        where: { id: draft.id },
        data: {
          transcript: pass1.output.transcript,
          speakerSegments: pass1.output.speakerSegments as unknown as Prisma.InputJsonValue,
          affectFeatures: pass1.output.affectFeatures as unknown as Prisma.InputJsonValue,
          totalCostInr: pass1Cost,
        },
      });

      // 4b. Cost circuit-breaker pre-check for Pass 2.
      const pass2Estimate = computeCostInr(
        Math.ceil(pass1.output.transcript.length / 4),
        1_500,
        PRO_PRICING,
      );
      await this.costGuard.checkBeforeCall({
        sessionId,
        psychologistId: session.psychologistId,
        estimatedCostInr: pass2Estimate,
      });

      // 5. Pass 2 — Sprint 19: kind drives the prompt branch.
      const pass2 = await this.router.pass2({
        sessionId,
        transcript: pass1.output.transcript,
        speakerSegments: pass1.output.speakerSegments,
        kind: session.kind,
        modality: session.modality,
        clientContext: {
          ...(session.client.presentingConcerns !== null && {
            presentingConcerns: session.client.presentingConcerns,
          }),
          ...(session.client.preferredModality !== null && {
            preferredModality: session.client
              .preferredModality as Parameters<typeof this.router.pass2>[0]['clientContext']['preferredModality'],
          }),
        },
      });
      const pass2Cost = new Prisma.Decimal(pass2.callLog.costInr);

      // 6. Persist Pass 2 + complete. Sprint 19: branch on discriminator.
      const pass2Body =
        pass2.output.kind === 'INTAKE' ? pass2.output.intakeNote : pass2.output.therapyNote;
      const pass2RiskFlags = pass2Body.riskFlags;
      const riskSeverity = mapRiskSeverity(pass2RiskFlags.severity);
      await this.prisma.noteDraft.update({
        where: { id: draft.id },
        data: {
          content: pass2Body as unknown as Prisma.InputJsonValue,
          riskSeverity,
          status: 'COMPLETED',
          totalCostInr: pass1Cost.plus(pass2Cost),
        },
      });

      // 7. Audit completion
      await this.audit.log({
        actorType: 'SYSTEM',
        action: 'NOTE_DRAFT_CREATED',
        targetType: 'NoteDraft',
        targetId: draft.id,
        metadata: {
          sessionId,
          pass1CostInr: pass1.callLog.costInr,
          pass2CostInr: pass2.callLog.costInr,
          totalCostInr: pass1.callLog.costInr + pass2.callLog.costInr,
          riskSeverity,
        },
      });

      // 8. Crisis flag escalation
      if (riskSeverity === 'HIGH' || riskSeverity === 'CRITICAL') {
        await this.audit.log({
          actorType: 'SYSTEM',
          action: 'CRISIS_FLAG_RAISED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            severity: riskSeverity,
            indicators: pass2RiskFlags.indicators,
            details: pass2RiskFlags.details ?? null,
            psychologistId: session.psychologistId,
            clientId: session.clientId,
            // NOTE: surface in therapist-web (Sprint 7). Auto-text iCall /
            // supervisor protocol awaits Sharafath sign-off (gap G3).
          },
        });
        this.logger.warn(`CRISIS flag raised on session=${sessionId} severity=${riskSeverity}`);
      }

      this.logger.log(`Note generation complete: session=${sessionId} draft=${draft.id}`);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`Note generation failed for session=${sessionId}: ${message}`);
      await this.prisma.noteDraft.update({
        where: { id: draft.id },
        data: { status: 'FAILED', errorMessage: message },
      });

      // Cost-trip audit + CIRCUIT_OPEN GeminiCallLog so the breaker state
      // shows up in cost reports next to the calls that actually ran.
      if (e instanceof CostCircuitOpenError) {
        await this.audit.log({
          actorType: 'SYSTEM',
          action: 'COST_CIRCUIT_TRIPPED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            scope: e.meta.scope,
            capInr: e.meta.capInr,
            currentInr: e.meta.currentInr,
            projectedInr: e.meta.projectedInr,
            psychologistId: session.psychologistId,
            clientId: session.clientId,
          },
        });
        await this.prisma.geminiCallLog.create({
          data: {
            sessionId,
            pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
            model: 'circuit-open',
            region: 'n/a',
            promptVersion: 'n/a',
            inputTokens: 0,
            outputTokens: 0,
            costInr: 0,
            latencyMs: 0,
            status: 'CIRCUIT_OPEN',
            errorMessage: message,
          },
        });
      }
    }
  }

  private async fetchAudio(sessionId: string): Promise<{ audioBytes: Buffer; durationMs: number }> {
    const chunks = await this.prisma.audioChunk.findMany({
      where: { sessionId },
      orderBy: { chunkIndex: 'asc' },
    });
    if (chunks.length === 0) return { audioBytes: Buffer.alloc(0), durationMs: 0 };

    const bucket = this.config.get<string>('S3_BUCKET_AUDIO') ?? 'cureocity-mind-audio';
    const buffers: Buffer[] = [];
    let totalDurationMs = 0;
    for (const chunk of chunks) {
      const body = await this.storage.get({ bucket, key: chunk.s3Key });
      buffers.push(body);
      totalDurationMs += chunk.durationMs;
    }
    return { audioBytes: Buffer.concat(buffers), durationMs: totalDurationMs };
  }
}

function mapRiskSeverity(severity: Pass1Output extends never ? never : string): PrismaRiskSeverity {
  switch (severity) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      return 'NONE';
  }
}
