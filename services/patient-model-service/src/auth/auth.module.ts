import { Global, Module } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { firebaseAdminProvider } from './firebase-admin.provider';

@Global()
@Module({
  providers: [firebaseAdminProvider, FirebaseAuthGuard],
  exports: [FirebaseAuthGuard, firebaseAdminProvider],
})
export class AuthModule {}
