import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { IStorageClient } from '@cureocity/storage';
import type { AuditMetadata } from '@cureocity/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_CLIENT } from '../storage/storage.module';

export interface AudioChunkUploadInput {
  chunkIndex: number;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
  body: Buffer;
}

export interface AudioChunkRecord {
  id: string;
  sessionId: string;
  chunkIndex: number;
  mimeType: string;
  sampleRate: number;
  sizeBytes: number;
  durationMs: number;
  s3Key: string;
  uploadedAt: string;
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(STORAGE_CLIENT) private readonly storage: IStorageClient,
  ) {}

  async uploadChunk(
    psychologistId: string,
    sessionId: string,
    input: AudioChunkUploadInput,
    auditMeta: AuditMetadata,
  ): Promise<AudioChunkRecord> {
    this.validateInput(input);

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.psychologistId !== psychologistId) {
      this.logger.warn(
        `Cross-tenant audio upload: psy=${psychologistId} session=${sessionId} (owned by ${session.psychologistId})`,
      );
      throw new NotFoundException('Session not found');
    }
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot upload audio for a session in ${session.status} state (must be IN_PROGRESS)`,
      );
    }

    const bucket = this.config.get<string>('S3_BUCKET_AUDIO') ?? 'cureocity-mind-audio';
    const s3Key = `sessions/${sessionId}/chunks/${String(input.chunkIndex).padStart(6, '0')}.pcm`;

    try {
      await this.storage.put({
        bucket,
        key: s3Key,
        body: input.body,
        contentType: input.mimeType,
        metadata: {
          sessionId,
          chunkIndex: String(input.chunkIndex),
          sampleRate: String(input.sampleRate),
        },
      });
    } catch (e) {
      this.logger.error(`Storage put failed for ${s3Key}: ${(e as Error).message}`);
      throw e;
    }

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.audioChunk.create({
          data: {
            sessionId,
            chunkIndex: input.chunkIndex,
            mimeType: input.mimeType,
            sampleRate: input.sampleRate,
            sizeBytes: input.body.byteLength,
            durationMs: input.durationMs,
            s3Key,
          },
        });
        await this.audit.log(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: psychologistId,
            action: 'AUDIO_CHUNK_UPLOADED',
            targetType: 'AudioChunk',
            targetId: created.id,
            metadata: {
              ...auditMeta,
              sessionId,
              chunkIndex: input.chunkIndex,
              sizeBytes: input.body.byteLength,
              durationMs: input.durationMs,
            },
          },
          tx,
        );
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Duplicate (sessionId, chunkIndex). Roll back the S3 put so we don't
        // leak orphan objects on retries — best-effort, ignore delete errors.
        await this.storage.delete({ bucket, key: s3Key }).catch(() => undefined);
        throw new ConflictException(
          `Chunk index ${input.chunkIndex} already uploaded for session ${sessionId}`,
        );
      }
      throw e;
    }

    return {
      id: row.id,
      sessionId: row.sessionId,
      chunkIndex: row.chunkIndex,
      mimeType: row.mimeType,
      sampleRate: row.sampleRate,
      sizeBytes: row.sizeBytes,
      durationMs: row.durationMs,
      s3Key: row.s3Key,
      uploadedAt: row.uploadedAt.toISOString(),
    };
  }

  private validateInput(input: AudioChunkUploadInput): void {
    if (input.chunkIndex < 0 || !Number.isInteger(input.chunkIndex)) {
      throw new BadRequestException('chunkIndex must be a non-negative integer');
    }
    if (input.durationMs <= 0 || !Number.isInteger(input.durationMs)) {
      throw new BadRequestException('durationMs must be a positive integer');
    }

    const acceptedMime = this.config.get<string>('AUDIO_ACCEPTED_MIME') ?? 'audio/pcm';
    if (!input.mimeType.startsWith(acceptedMime)) {
      throw new UnsupportedMediaTypeException(
        `Expected mimeType starting with "${acceptedMime}", got "${input.mimeType}"`,
      );
    }

    const acceptedRate = this.config.get<number>('AUDIO_ACCEPTED_SAMPLE_RATE') ?? 16000;
    if (input.sampleRate !== acceptedRate) {
      throw new BadRequestException(
        `sampleRate must be ${acceptedRate} Hz (got ${input.sampleRate})`,
      );
    }

    const maxBytes = this.config.get<number>('AUDIO_MAX_CHUNK_BYTES') ?? 15 * 1024 * 1024;
    if (input.body.byteLength > maxBytes) {
      throw new PayloadTooLargeException(
        `Chunk size ${input.body.byteLength} exceeds max ${maxBytes} bytes`,
      );
    }
    if (input.body.byteLength === 0) {
      throw new BadRequestException('Chunk body must not be empty');
    }
  }
}
