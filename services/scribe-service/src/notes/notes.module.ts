import { DynamicModule, Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LlmModule } from '../llm/llm.module';
import { CostModule } from '../cost/cost.module';
import { NoteOrchestrator } from './note-orchestrator';
import { NoteGenerationProcessor } from './note-generation.processor';
import { NotesService } from './notes.service';

/**
 * Configurable module — when NOTE_QUEUE_BACKEND=sync, the BullMQ
 * Queue + Processor are NOT registered (no Redis required, useful for
 * tests and local dev when Redis isn't running). NotesService runs
 * the orchestrator inline in that mode.
 */
@Module({})
export class NotesModule {
  static register(): DynamicModule {
    const logger = new Logger('NotesModule');
    const queueBackend = process.env['NOTE_QUEUE_BACKEND'] ?? 'bullmq';
    const queueName = process.env['NOTE_QUEUE_NAME'] ?? 'note-generation';

    if (queueBackend === 'sync') {
      logger.warn('NOTE_QUEUE_BACKEND=sync; BullMQ not registered (note generation runs inline)');
      return {
        module: NotesModule,
        imports: [LlmModule, CostModule],
        providers: [NoteOrchestrator, NotesService],
        exports: [NotesService],
      };
    }

    return {
      module: NotesModule,
      imports: [
        LlmModule,
        CostModule,
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
            },
          }),
        }),
        BullModule.registerQueue({ name: queueName }),
      ],
      providers: [NoteOrchestrator, NoteGenerationProcessor, NotesService],
      exports: [NotesService],
    };
  }
}
