import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';
import { SessionsModule } from './sessions/sessions.module';
import { AudioModule } from './audio/audio.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    StorageModule,
    LlmModule,
    HealthModule,
    SessionsModule,
    AudioModule,
  ],
})
export class AppModule {}
