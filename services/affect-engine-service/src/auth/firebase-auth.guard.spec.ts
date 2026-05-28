import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import type { FirebaseAdminApp } from './firebase-admin.provider';
import type { PrismaService } from '../prisma/prisma.service';

function makeExecutionContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function makeConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

function makePrisma(psychologistId: string | null): PrismaService {
  return {
    psychologist: {
      findUnique: vi.fn().mockResolvedValue(psychologistId ? { id: psychologistId } : null),
    },
  } as unknown as PrismaService;
}

function makeFirebase(verifyImpl: (token: string) => Promise<{ uid: string; email?: string }>) {
  const verifyIdToken = vi.fn(verifyImpl);
  const app = { auth: () => ({ verifyIdToken }) } as unknown as FirebaseAdminApp;
  return { app, verifyIdToken };
}

describe('FirebaseAuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AUTH_BYPASS=true', () => {
    it('attaches dev user without psychologistId when no row exists yet', async () => {
      const req: Record<string, unknown> = { headers: {} };
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: true }),
        null,
        makePrisma(null),
      );
      const ok = await guard.canActivate(makeExecutionContext(req));
      expect(ok).toBe(true);
      const user = req['user'] as Record<string, unknown>;
      expect(user).toMatchObject({
        firebaseUid: 'dev-firebase-uid-priya',
        email: 'priya.menon@example.in',
      });
      expect(user['psychologistId']).toBeUndefined();
    });

    it('resolves psychologistId when the row exists', async () => {
      const req: Record<string, unknown> = { headers: {} };
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: true }),
        null,
        makePrisma('psy_123'),
      );
      await guard.canActivate(makeExecutionContext(req));
      const user = req['user'] as Record<string, unknown>;
      expect(user['psychologistId']).toBe('psy_123');
    });
  });

  describe('AUTH_BYPASS=false', () => {
    it('rejects when Firebase Admin is not configured', async () => {
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: false }),
        null,
        makePrisma(null),
      );
      await expect(guard.canActivate(makeExecutionContext({ headers: {} }))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when Bearer header is missing', async () => {
      const { app } = makeFirebase(async () => ({ uid: 'x' }));
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: false }),
        app,
        makePrisma(null),
      );
      await expect(guard.canActivate(makeExecutionContext({ headers: {} }))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when Authorization header lacks "Bearer " prefix', async () => {
      const { app } = makeFirebase(async () => ({ uid: 'x' }));
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: false }),
        app,
        makePrisma(null),
      );
      await expect(
        guard.canActivate(makeExecutionContext({ headers: { authorization: 'Basic abc' } })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a valid token and attaches user with psychologistId', async () => {
      const { app, verifyIdToken } = makeFirebase(async () => ({
        uid: 'firebase-uid-abc',
        email: 'real@example.in',
      }));
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: false }),
        app,
        makePrisma('psy_xyz'),
      );
      const req: Record<string, unknown> = {
        headers: { authorization: 'Bearer real-token-here' },
      };
      const ok = await guard.canActivate(makeExecutionContext(req));
      expect(ok).toBe(true);
      expect(verifyIdToken).toHaveBeenCalledWith('real-token-here');
      expect(req['user']).toMatchObject({
        firebaseUid: 'firebase-uid-abc',
        email: 'real@example.in',
        psychologistId: 'psy_xyz',
      });
    });

    it('rejects when token verification throws', async () => {
      const { app } = makeFirebase(async () => {
        throw new Error('token expired');
      });
      const guard = new FirebaseAuthGuard(
        makeConfig({ AUTH_BYPASS: false }),
        app,
        makePrisma(null),
      );
      await expect(
        guard.canActivate(makeExecutionContext({ headers: { authorization: 'Bearer bad' } })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
