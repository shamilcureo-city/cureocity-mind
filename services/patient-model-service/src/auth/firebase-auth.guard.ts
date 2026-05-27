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
import { FIREBASE_ADMIN, FirebaseAdminApp } from './firebase-admin.provider';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';

const DEV_BYPASS_FIREBASE_UID = 'dev-firebase-uid-priya';
const DEV_BYPASS_EMAIL = 'priya.menon@example.in';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(FIREBASE_ADMIN) private readonly firebase: FirebaseAdminApp,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (this.config.get<boolean>('AUTH_BYPASS')) {
      const user: AuthenticatedUser = {
        firebaseUid: DEV_BYPASS_FIREBASE_UID,
        email: DEV_BYPASS_EMAIL,
      };
      const psy = await this.prisma.psychologist.findUnique({
        where: { firebaseUid: user.firebaseUid },
        select: { id: true, role: true },
      });
      if (psy) {
        user.psychologistId = psy.id;
        user.role = psy.role;
      }
      req.user = user;
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
      const psy = await this.prisma.psychologist.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true, role: true },
      });
      const user: AuthenticatedUser = {
        firebaseUid: decoded.uid,
        ...(decoded.email !== undefined && { email: decoded.email }),
        ...(psy && { psychologistId: psy.id, role: psy.role }),
      };
      req.user = user;
      return true;
    } catch (e) {
      this.logger.warn(`Auth failed: ${(e as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
