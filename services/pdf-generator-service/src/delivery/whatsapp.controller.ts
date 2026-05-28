import {
  Controller,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { auditMetadataFromRequest } from '../common/request-context';
import { WhatsAppDeliveryService } from './whatsapp.service';

@Controller('whatsapp')
@UseGuards(FirebaseAuthGuard)
export class WhatsAppController {
  constructor(private readonly service: WhatsAppDeliveryService) {}

  @Post('treatment-plans/:clientId')
  @HttpCode(200)
  async sendTreatmentPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Query('locale') locale: string | undefined,
    @Req() req: Request,
  ) {
    return this.service.sendTreatmentPlan(
      requirePsy(user),
      clientId,
      locale,
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
