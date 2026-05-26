/// <reference types="multer" />
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { auditMetadataFromRequest } from '../common/request-context';
import { AudioService } from './audio.service';

@Controller('sessions/:id/audio-chunks')
@UseGuards(FirebaseAuthGuard)
export class AudioController {
  constructor(private readonly service: AudioService) {}

  /**
   * Multipart upload. Fields (form-data):
   *   chunk         file       the raw PCM bytes
   *   chunkIndex    string     monotonic, 0-based
   *   mimeType      string     e.g. "audio/pcm;rate=16000"
   *   sampleRate    string     "16000"
   *   durationMs    string     milliseconds in this chunk
   */
  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('chunk'))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!user.psychologistId) {
      throw new ForbiddenException(
        'Firebase user has not registered as a Psychologist yet. POST /api/v1/psychologists on patient-model-service first.',
      );
    }
    if (!file) throw new BadRequestException('Missing "chunk" form field with file body');

    const body = req.body as Record<string, string | undefined>;
    const chunkIndex = parseIntStrict(body['chunkIndex'], 'chunkIndex');
    const sampleRate = parseIntStrict(body['sampleRate'], 'sampleRate');
    const durationMs = parseIntStrict(body['durationMs'], 'durationMs');
    const mimeType = body['mimeType'] ?? file.mimetype;
    if (typeof mimeType !== 'string' || mimeType.length === 0) {
      throw new BadRequestException('Missing mimeType field');
    }

    return this.service.uploadChunk(
      user.psychologistId,
      sessionId,
      {
        chunkIndex,
        mimeType,
        sampleRate,
        durationMs,
        body: file.buffer,
      },
      auditMetadataFromRequest(req),
    );
  }
}

function parseIntStrict(raw: string | undefined, field: string): number {
  if (raw === undefined) throw new BadRequestException(`Missing form field: ${field}`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new BadRequestException(`Field "${field}" must be an integer`);
  return n;
}
