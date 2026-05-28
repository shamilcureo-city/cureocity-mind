import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogQuerySchema, type AuditLogQuery } from '@cureocity/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditMetadataFromRequest } from '../common/request-context';
import { AdminService } from './admin.service';
import { AdminRoleGuard } from './admin-role.guard';

@Controller('admin')
@UseGuards(FirebaseAuthGuard, AdminRoleGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('audit-logs')
  async listAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(AuditLogQuerySchema)) query: AuditLogQuery,
    @Req() req: Request,
  ) {
    // psychologistId is guaranteed by AdminRoleGuard.
    return this.service.listAuditLogs(user.psychologistId!, query, auditMetadataFromRequest(req));
  }

  @Post('psychologists/:id/grant-admin')
  @HttpCode(204)
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.grantAdmin(user.psychologistId!, id, auditMetadataFromRequest(req));
  }

  @Post('psychologists/:id/revoke-admin')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.revokeAdmin(user.psychologistId!, id, auditMetadataFromRequest(req));
  }
}
