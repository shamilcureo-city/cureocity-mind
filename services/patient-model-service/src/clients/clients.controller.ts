import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateClientInputSchema,
  ListClientsQuerySchema,
  UpdateClientInputSchema,
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(FirebaseAuthGuard)
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateClientInputSchema)) dto: CreateClientInput,
    @Req() req: Request,
  ) {
    const psyId = requirePsychologistId(user);
    return this.service.create(psyId, dto, auditMetadataFromRequest(req));
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(ListClientsQuerySchema)) query: ListClientsQuery,
  ) {
    const psyId = requirePsychologistId(user);
    return this.service.list(psyId, query);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    const psyId = requirePsychologistId(user);
    return this.service.get(psyId, id, auditMetadataFromRequest(req));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateClientInputSchema)) dto: UpdateClientInput,
    @Req() req: Request,
  ) {
    const psyId = requirePsychologistId(user);
    return this.service.update(psyId, id, dto, auditMetadataFromRequest(req));
  }

  @Get(':id/briefing')
  async briefing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const psyId = requirePsychologistId(user);
    return this.service.briefing(psyId, id, auditMetadataFromRequest(req));
  }
}

function requirePsychologistId(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException(
      'Firebase user has not registered as a Psychologist yet. POST /psychologists first.',
    );
  }
  return user.psychologistId;
}
