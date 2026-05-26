import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NoteOrchestrator } from './note-orchestrator';

export const NOTE_GENERATION_JOB = 'generate';

export interface NoteGenerationJobData {
  sessionId: string;
}

/**
 * BullMQ worker for the note-generation queue. The queue name is whatever
 * NOTE_QUEUE_NAME resolves to at NotesModule registration time.
 */
@Processor('note-generation')
export class NoteGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(NoteGenerationProcessor.name);

  constructor(private readonly orchestrator: NoteOrchestrator) {
    super();
  }

  async process(job: Job<NoteGenerationJobData>): Promise<void> {
    this.logger.log(`Processing note-generation job ${job.id} for session=${job.data.sessionId}`);
    await this.orchestrator.run(job.data.sessionId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NoteGenerationJobData>, err: Error): void {
    this.logger.error(
      `Note-generation job failed: id=${job.id} session=${job.data.sessionId} error=${err.message}`,
    );
  }
}
