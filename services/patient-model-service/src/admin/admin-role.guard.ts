import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * AdminRoleGuard — must run AFTER FirebaseAuthGuard.
 *
 * The chain is `@UseGuards(FirebaseAuthGuard, AdminRoleGuard)`: Firebase
 * resolves the user (including role), then this guard enforces that the
 * resolved user has ADMIN role. THERAPIST or unregistered users get a
 * 403 with no leak about whether the underlying surface exists.
 *
 * V1 admin role is granted out-of-band (direct DB update + ADMIN_ROLE_GRANTED
 * audit row). Gap G9, Sprint 9 PR 1.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user || !req.user.psychologistId) {
      throw new ForbiddenException('Admin access requires a registered Psychologist account');
    }
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
