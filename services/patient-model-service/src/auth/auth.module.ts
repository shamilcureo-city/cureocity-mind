import { Global, Module } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { FirebaseUidGuard } from './firebase-uid.guard';
import { firebaseAdminProvider } from './firebase-admin.provider';

@Global()
@Module({
  providers: [firebaseAdminProvider, FirebaseAuthGuard, FirebaseUidGuard],
  exports: [FirebaseAuthGuard, FirebaseUidGuard, firebaseAdminProvider],
})
export class AuthModule {}
