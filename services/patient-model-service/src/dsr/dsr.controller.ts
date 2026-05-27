import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  DsrConsentWithdrawalInputSchema,
  DsrCorrectionInputSchema,
  DsrErasureInputSchema,
  DsrGrievanceInputSchema,
  DsrNominationInputSchema,
  type DsrConsentWithdrawalInput,
  type DsrCorrectionInput,
  type DsrErasureInput,
  type DsrGrievanceInput,
  type DsrNominationInput,
} from '@cureocity/contracts';
import {
  ClientAuthGuard,
  CurrentClient,
  type AuthenticatedClient,
} from '../auth/client-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { DsrService } from './dsr.service';

@Controller('me/dsr')
@UseGuards(ClientAuthGuard)
export class DsrController {
  constructor(private readonly service: DsrService) {}

  @Get('data-export')
  async export(@CurrentClient() client: AuthenticatedClient, @Req() req: Request) {
    return this.service.exportData(client.clientId, auditMetadataFromRequest(req));
  }

  @Patch('profile')
  @HttpCode(204)
  async correction(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(DsrCorrectionInputSchema)) dto: DsrCorrectionInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.requestCorrection(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Post('nominations')
  @HttpCode(201)
  async nominate(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(DsrNominationInputSchema)) dto: DsrNominationInput,
    @Req() req: Request,
  ) {
    return this.service.recordNomination(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Post('consent-withdrawals')
  @HttpCode(204)
  async withdraw(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(DsrConsentWithdrawalInputSchema)) dto: DsrConsentWithdrawalInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.withdrawConsent(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Post('grievances')
  @HttpCode(201)
  async grievance(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(DsrGrievanceInputSchema)) dto: DsrGrievanceInput,
    @Req() req: Request,
  ) {
    return this.service.fileGrievance(client.clientId, dto, auditMetadataFromRequest(req));
  }

  @Post('erasure-requests')
  @HttpCode(201)
  async erasure(
    @CurrentClient() client: AuthenticatedClient,
    @Body(new ZodValidationPipe(DsrErasureInputSchema)) dto: DsrErasureInput,
    @Req() req: Request,
  ) {
    return this.service.requestErasure(client.clientId, dto, auditMetadataFromRequest(req));
  }
}
