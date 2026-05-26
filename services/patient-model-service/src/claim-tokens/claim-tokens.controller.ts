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
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentFirebaseUid, FirebaseUidGuard } from '../auth/firebase-uid.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { auditMetadataFromRequest } from '../common/request-context';
import { ClaimTokensService } from './claim-tokens.service';

/**
 * Routes:
 *   POST /api/v1/clients/:id/claim-token             — therapist auth
 *   GET  /api/v1/claim-tokens/:token                 — public preview
 *   POST /api/v1/claim-tokens/:token/redeem          — client Firebase auth
 */
@Controller()
export class ClaimTokensController {
  constructor(private readonly service: ClaimTokensService) {}

  @Post('clients/:id/claim-token')
  @UseGuards(FirebaseAuthGuard)
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') clientId: string,
    @Req() req: Request,
  ) {
    if (!user.psychologistId) {
      throw new ForbiddenException(
        'Firebase user has not registered as a Psychologist yet. POST /psychologists first.',
      );
    }
    return this.service.issue(user.psychologistId, clientId, auditMetadataFromRequest(req));
  }

  @Get('claim-tokens/:token')
  async preview(@Param('token') token: string) {
    return this.service.preview(token);
  }

  @Post('claim-tokens/:token/redeem')
  @HttpCode(200)
  @UseGuards(FirebaseUidGuard)
  async redeem(
    @CurrentFirebaseUid() firebaseUid: string,
    @Param('token') token: string,
    @Req() req: Request,
    @Body() _body: unknown,
  ) {
    return this.service.redeem(token, firebaseUid, auditMetadataFromRequest(req));
  }
}
