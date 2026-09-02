import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

export const FIREBASE_ADMIN = Symbol('FIREBASE_ADMIN');

export type FirebaseAdminApp = App | null;

/**
 * Returns a Firebase Admin app when service-account creds are configured.
 * Returns null otherwise — the auth guard treats that as "real auth not
 * available" and only the AUTH_BYPASS path will succeed.
 */
export const firebaseAdminProvider: Provider = {
  provide: FIREBASE_ADMIN,
  inject: [ConfigService],
  useFactory: (config: ConfigService): FirebaseAdminApp => {
    const logger = new Logger('FirebaseAdmin');
    const projectId = config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      logger.warn(
        'Firebase Admin not initialised (missing creds). Real token verification will fail; AUTH_BYPASS=true required.',
      );
      return null;
    }

    const apps = getApps();
    if (apps.length > 0) return apps[0]!;

    const app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    logger.log(`Firebase Admin initialised for project ${projectId}`);
    return app;
  },
};
