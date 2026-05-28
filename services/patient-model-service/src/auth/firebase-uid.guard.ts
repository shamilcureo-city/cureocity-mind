import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { FIREBASE_ADMIN, FirebaseAdminApp } from './firebase-admin.provider';

const DEV_BYPASS_CLIENT_FIREBASE_UID = 'dev-client-firebase-uid-arjun';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by FirebaseUidGuard. Use CurrentFirebaseUid() to read it. */
    firebaseUidPayload?: { uid: string };
  }
}

/**
 * FirebaseUidGuard — verifies a Firebase ID token and attaches the uid to
 * the request. Does NOT require the uid to resolve to a Psychologist or
 * Client; used by the claim-token redeem endpoint, where the uid is
 * authenticated but not yet bound to any application identity.
 */
@Injectable()
export class FirebaseUidGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseUidGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(FIREBASE_ADMIN) private readonly firebase: FirebaseAdminApp,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (this.config.get<boolean>('AUTH_BYPASS')) {
      req.firebaseUidPayload = { uid: DEV_BYPASS_CLIENT_FIREBASE_UID };
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
      req.firebaseUidPayload = { uid: decoded.uid };
      return true;
    } catch (e) {
      this.logger.warn(`FirebaseUidGuard auth failed: ${(e as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}

export const CurrentFirebaseUid = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.firebaseUidPayload) {
      throw new Error('CurrentFirebaseUid used on a route without FirebaseUidGuard');
    }
    return req.firebaseUidPayload.uid;
  },
);
