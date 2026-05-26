import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateSessionInputSchema,
  SessionConsentAckInputSchema,
  type CreateSessionInput,
  type SessionConsentAckInput,
} from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(FirebaseAuthGuard)
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateSessionInputSchema)) dto: CreateSessionInput,
    @Req() req: Request,
  ) {
    return this.service.create(requirePsychologistId(user), dto, auditMetadataFromRequest(req));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.get(requirePsychologistId(user), id, auditMetadataFromRequest(req));
  }

  @Post(':id/consent')
  @HttpCode(200)
  async recordConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SessionConsentAckInputSchema)) dto: SessionConsentAckInput,
    @Req() req: Request,
  ) {
    return this.service.recordConsent(
      requirePsychologistId(user),
      id,
      dto,
      auditMetadataFromRequest(req),
    );
  }

  @Post(':id/start')
  @HttpCode(200)
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.start(requirePsychologistId(user), id, auditMetadataFromRequest(req));
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.end(requirePsychologistId(user), id, auditMetadataFromRequest(req));
  }

  @Get(':id/note-draft')
  async noteDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.getNoteDraft(
      requirePsychologistId(user),
      id,
      auditMetadataFromRequest(req),
    );
  }
}

function requirePsychologistId(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException(
      'Firebase user has not registered as a Psychologist yet. POST /api/v1/psychologists on patient-model-service first.',
    );
  }
  return user.psychologistId;
}
