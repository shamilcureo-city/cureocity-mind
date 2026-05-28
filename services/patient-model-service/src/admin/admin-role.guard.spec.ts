import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AdminRoleGuard } from './admin-role.guard';

function ctx(user: Request['user']): ExecutionContext {
  const req = { user } as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AdminRoleGuard', () => {
  const guard = new AdminRoleGuard();

  it('allows ADMIN role', () => {
    expect(
      guard.canActivate(
        ctx({ firebaseUid: 'u', psychologistId: 'cpsy11111111111111111111x', role: 'ADMIN' }),
      ),
    ).toBe(true);
  });

  it('rejects THERAPIST role', () => {
    expect(() =>
      guard.canActivate(
        ctx({ firebaseUid: 'u', psychologistId: 'cpsy11111111111111111111x', role: 'THERAPIST' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects unregistered Firebase user (no psychologistId)', () => {
    expect(() => guard.canActivate(ctx({ firebaseUid: 'u' }))).toThrow(ForbiddenException);
  });

  it('rejects when user is missing entirely', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
