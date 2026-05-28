import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { NoteDraft, AuditMetadata } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NoteOrchestrator } from './note-orchestrator';
import { NOTE_GENERATION_JOB, type NoteGenerationJobData } from './note-generation.processor';
import { toNoteDraft } from './note.mappers';

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);
  private readonly syncMode: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orchestrator: NoteOrchestrator,
    private readonly config: ConfigService,
    @Optional()
    @InjectQueue('note-generation')
    private readonly queue?: Queue<NoteGenerationJobData>,
  ) {
    this.syncMode = this.config.get<string>('NOTE_QUEUE_BACKEND') === 'sync';
  }

  /**
   * Enqueue a note-generation job for a session. Called when SessionsService.end()
   * succeeds. In sync mode (tests + dev convenience), runs inline so the response
   * lands with a completed draft already.
   */
  async enqueueGeneration(sessionId: string): Promise<void> {
    if (this.syncMode || !this.queue) {
      this.logger.log(`NOTE_QUEUE_BACKEND=sync; running orchestrator inline for ${sessionId}`);
      await this.orchestrator.run(sessionId);
      return;
    }
    await this.queue.add(
      NOTE_GENERATION_JOB,
      { sessionId },
      {
        jobId: sessionId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    );
    this.logger.log(`Enqueued note generation for session=${sessionId}`);
  }

  async getDraftForSession(
    psychologistId: string,
    sessionId: string,
    auditMeta: AuditMetadata,
  ): Promise<NoteDraft> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { psychologistId: true },
    });
    if (!session || session.psychologistId !== psychologistId) {
      throw new NotFoundException('Session not found');
    }
    const draft = await this.prisma.noteDraft.findUnique({ where: { sessionId } });
    if (!draft) {
      throw new NotFoundException('Note draft not yet generated');
    }
    await this.audit.log({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: psychologistId,
      action: 'NOTE_DRAFT_VIEWED',
      targetType: 'NoteDraft',
      targetId: draft.id,
      metadata: auditMeta,
    });
    return toNoteDraft(draft);
  }
}
