import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateJournalEntryInputSchema,
  CreateMoodLogInputSchema,
  RecordCompletionInputSchema,
  RegisterPushSubscriptionInputSchema,
  type CreateJournalEntryInput,
  type CreateMoodLogInput,
  type RecordCompletionInput,
  type RegisterPushSubscriptionInput,
} from '@cureocity/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { ClientAuthGuard, CurrentClient, type AuthenticatedClient } from './client-auth.guard';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(ClientAuthGuard)
export class MeController {
  constructor(private readonly service: MeService) {}

  @Get('exercises')
  async exercises(@CurrentClient() client: AuthenticatedClient) {
    return this.service.listExercises(client.clientId);
  }

  @Get('exercises/:id')
  async exercise(@CurrentClient() client: AuthenticatedClient, @Param('id') id: string) {
    return this.service.getExercise(client.clientId, id);
  }

  @Post('exercises/:id/completions')
  @HttpCode(200)
  async complete(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordCompletionInputSchema)) dto: RecordCompletionInput,
    @Req() req: Request,
  ) {
    return this.service.recordCompletion(client.clientId, id, dto, auditMetadataFromRequest(req));
  }

  @Post('mood-logs')
  @HttpCode(201)
  async logMood(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(CreateMoodLogInputSchema)) dto: CreateMoodLogInput,
    @Req() req: Request,
  ) {
    return this.service.logMood(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Get('mood-logs')
  async listMoods(@CurrentClient() client: AuthenticatedClient, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : undefined;
    return this.service.listMoods(client.clientId, n);
  }

  @Post('journal-entries')
  @HttpCode(201)
  async createJournal(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(CreateJournalEntryInputSchema)) dto: CreateJournalEntryInput,
    @Req() req: Request,
  ) {
    return this.service.createJournal(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Get('journal-entries')
  async listJournals(@CurrentClient() client: AuthenticatedClient, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : undefined;
    return this.service.listJournals(client.clientId, n);
  }

  @Get('next-session')
  async nextSession(@CurrentClient() client: AuthenticatedClient) {
    return this.service.getNextSession(client.clientId);
  }

  @Post('push-subscriptions')
  @HttpCode(201)
  async registerPush(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(RegisterPushSubscriptionInputSchema))
    dto: RegisterPushSubscriptionInput,
    @Req() req: Request,
  ) {
    return this.service.registerPushSubscription(
      client.clientId,
      dto,
      auditMetadataFromRequest(req),
    );
  }

  @Delete('push-subscriptions/:id')
  @HttpCode(204)
  async revokePush(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.revokePushSubscription(client.clientId, id, auditMetadataFromRequest(req));
  }
}
