import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { FIREBASE_ADMIN, type FirebaseAdminApp } from '../auth/firebase-admin.provider';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedClient {
  clientId: string;
  firebaseUid: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    client?: AuthenticatedClient;
  }
}

/**
 * Client-side Firebase auth guard. Distinct from FirebaseAuthGuard
 * (which resolves to Psychologist.firebaseUid). This one resolves to
 * Client.clientFirebaseUid.
 *
 * AUTH_BYPASS=true: injects a dev client identity, resolved by the
 * fixed dev firebase uid 'dev-client-firebase-uid-arjun'. The seed
 * script (Sprint 1) creates a client with id 'seed-client-arjun';
 * production claim flow (Sprint 8) sets clientFirebaseUid on it.
 */
const DEV_BYPASS_CLIENT_FIREBASE_UID = 'dev-client-firebase-uid-arjun';

@Injectable()
export class ClientAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClientAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(FIREBASE_ADMIN) private readonly firebase: FirebaseAdminApp,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (this.config.get<boolean>('AUTH_BYPASS')) {
      const client = await this.prisma.client.findUnique({
        where: { clientFirebaseUid: DEV_BYPASS_CLIENT_FIREBASE_UID },
      });
      if (!client) {
        throw new UnauthorizedException(
          'Bypass client not found. Seed a Client with clientFirebaseUid=dev-client-firebase-uid-arjun.',
        );
      }
      if (client.deletedAt !== null || client.status !== 'ACTIVE') {
        throw new UnauthorizedException('Bypass client is not active');
      }
      req.client = { clientId: client.id, firebaseUid: DEV_BYPASS_CLIENT_FIREBASE_UID };
      return true;
    }

    if (!this.firebase) {
      throw new UnauthorizedException('Firebase Admin not configured and AUTH_BYPASS is false');
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = header.substring('Bearer '.length);

    try {
      const decoded = await this.firebase.auth().verifyIdToken(token);
      const client = await this.prisma.client.findUnique({
        where: { clientFirebaseUid: decoded.uid },
      });
      if (!client) {
        throw new UnauthorizedException('No client linked to this Firebase identity');
      }
      if (client.deletedAt !== null || client.status !== 'ACTIVE') {
        throw new UnauthorizedException('Client is not active');
      }
      req.client = { clientId: client.id, firebaseUid: decoded.uid };
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn(`Client auth failed: ${(e as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}

import { createParamDecorator } from '@nestjs/common';
export const CurrentClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedClient => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.client) {
      throw new Error('CurrentClient used on a route without ClientAuthGuard');
    }
    return req.client;
  },
);
