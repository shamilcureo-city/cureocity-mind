import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { firebaseAdminProvider } from './firebase-admin.provider';

@Module({
  providers: [firebaseAdminProvider, FirebaseAuthGuard],
  exports: [FirebaseAuthGuard, firebaseAdminProvider],
})
export class AuthModule {}
