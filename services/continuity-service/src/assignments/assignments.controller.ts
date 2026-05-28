import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateExerciseAssignmentInputSchema,
  type CreateExerciseAssignmentInput,
} from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { AssignmentsService } from './assignments.service';
import { AdherenceService } from '../adherence/adherence.service';

@Controller('clients/:clientId')
@UseGuards(FirebaseAuthGuard)
export class ClientAssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly adherence: AdherenceService,
  ) {}

  @Post('exercise-assignments')
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(CreateExerciseAssignmentInputSchema))
    dto: CreateExerciseAssignmentInput,
    @Req() req: Request,
  ) {
    // Body's clientId must match the URL param.
    if (dto.clientId !== clientId) {
      throw new ForbiddenException('Body clientId must match URL clientId');
    }
    return this.assignments.assign(requirePsy(user), dto, auditMetadataFromRequest(req));
  }

  @Get('exercise-assignments')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('clientId') clientId: string) {
    return this.assignments.listForClient(requirePsy(user), clientId);
  }

  @Get('adherence')
  async getAdherence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Req() req: Request,
  ) {
    return this.adherence.summaryFor(requirePsy(user), clientId, auditMetadataFromRequest(req));
  }
}

function requirePsy(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException('Firebase user has not registered as a Psychologist yet.');
  }
  return user.psychologistId;
}
