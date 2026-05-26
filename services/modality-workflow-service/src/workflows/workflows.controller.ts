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
  CreateTransitionInputSchema,
  CreateWorkflowInputSchema,
  type CreateTransitionInput,
  type CreateWorkflowInput,
} from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
@UseGuards(FirebaseAuthGuard)
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateWorkflowInputSchema)) dto: CreateWorkflowInput,
    @Req() req: Request,
  ) {
    return this.service.create(requirePsy(user), dto, auditMetadataFromRequest(req));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.get(requirePsy(user), id, auditMetadataFromRequest(req));
  }

  @Post(':id/transitions')
  @HttpCode(200)
  async recordTransition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateTransitionInputSchema)) dto: CreateTransitionInput,
    @Req() req: Request,
  ) {
    return this.service.recordTransition(requirePsy(user), id, dto, auditMetadataFromRequest(req));
  }

  @Get(':id/advancement-suggestion')
  async getAdvancement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.getAdvancementSuggestion(
      requirePsy(user),
      id,
      auditMetadataFromRequest(req),
    );
  }
}

function requirePsy(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException('Firebase user has not registered as a Psychologist yet.');
  }
  return user.psychologistId;
}
