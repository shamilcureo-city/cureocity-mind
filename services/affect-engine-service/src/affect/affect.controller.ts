import { Controller, ForbiddenException, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { auditMetadataFromRequest } from '../common/request-context';
import { AffectService } from './affect.service';

@Controller('affect/clients/:clientId')
@UseGuards(FirebaseAuthGuard)
export class AffectController {
  constructor(private readonly service: AffectService) {}

  @Get('baseline')
  async getBaseline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Req() req: Request,
  ) {
    return this.service.getBaseline(requirePsy(user), clientId, auditMetadataFromRequest(req));
  }

  @Get('trend')
  async getTrend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Req() req: Request,
  ) {
    return this.service.getTrend(requirePsy(user), clientId, auditMetadataFromRequest(req));
  }
}

function requirePsy(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException('Firebase user has not registered as a Psychologist yet.');
  }
  return user.psychologistId;
}
