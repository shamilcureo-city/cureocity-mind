import { Controller, ForbiddenException, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PdfsService, parseLocale } from './pdfs.service';

@Controller('pdfs')
@UseGuards(FirebaseAuthGuard)
export class PdfsController {
  constructor(private readonly service: PdfsService) {}

  @Get('session-notes/:sessionId')
  async sessionNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Query('locale') localeRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.renderSessionNote(
      requirePsy(user),
      sessionId,
      parseLocale(localeRaw),
    );
    res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `attachment; filename="session-note-${sessionId}.pdf"`)
      .send(pdf);
  }

  @Get('treatment-plans/:clientId')
  async treatmentPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Query('locale') localeRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.renderTreatmentPlan(
      requirePsy(user),
      clientId,
      parseLocale(localeRaw),
    );
    res
      .set('Content-Type', 'application/pdf')
      .set('Content-Disposition', `attachment; filename="treatment-plan-${clientId}.pdf"`)
      .send(pdf);
  }
}

function requirePsy(user: AuthenticatedUser): string {
  if (!user.psychologistId) {
    throw new ForbiddenException('Firebase user has not registered as a Psychologist yet.');
  }
  return user.psychologistId;
}
