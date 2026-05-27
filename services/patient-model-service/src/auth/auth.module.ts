import { Global, Module } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { FirebaseUidGuard } from './firebase-uid.guard';
import { ClientAuthGuard } from './client-auth.guard';
import { firebaseAdminProvider } from './firebase-admin.provider';

@Global()
@Module({
  providers: [firebaseAdminProvider, FirebaseAuthGuard, FirebaseUidGuard, ClientAuthGuard],
  exports: [FirebaseAuthGuard, FirebaseUidGuard, ClientAuthGuard, firebaseAdminProvider],
})
export class AuthModule {}
