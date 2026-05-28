import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateEmdrTargetInputSchema,
  PreparationCompleteInputSchema,
  UpdateEmdrTargetInputSchema,
  type CreateEmdrTargetInput,
  type PreparationCompleteInput,
  type UpdateEmdrTargetInput,
} from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { EmdrService } from './emdr.service';

@Controller('workflows/:id/emdr')
@UseGuards(FirebaseAuthGuard)
export class EmdrController {
  constructor(private readonly service: EmdrService) {}

  @Post('preparation-complete')
  @HttpCode(200)
  async preparationComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreparationCompleteInputSchema)) dto: PreparationCompleteInput,
    @Req() req: Request,
  ) {
    return this.service.markPreparationComplete(
      requirePsy(user),
      id,
      dto,
      auditMetadataFromRequest(req),
    );
  }

  @Post('targets')
  @HttpCode(201)
  async addTarget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateEmdrTargetInputSchema)) dto: CreateEmdrTargetInput,
    @Req() req: Request,
  ) {
    return this.service.addTarget(requirePsy(user), id, dto, auditMetadataFromRequest(req));
  }

  @Get('targets')
  async listTargets(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listTargets(requirePsy(user), id);
  }

  @Patch('targets/:targetId')
  async updateTarget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Body(new ZodValidationPipe(UpdateEmdrTargetInputSchema)) dto: UpdateEmdrTargetInput,
    @Req() req: Request,
  ) {
    return this.service.updateTarget(
      requirePsy(user),
      id,
      targetId,
      dto,
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
