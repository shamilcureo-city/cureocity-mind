import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { PsychologistsModule } from './psychologists/psychologists.module';
import { ClientsModule } from './clients/clients.module';
import { ClaimTokensModule } from './claim-tokens/claim-tokens.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    HealthModule,
    PsychologistsModule,
    ClientsModule,
    ClaimTokensModule,
    AdminModule,
  ],
})
export class AppModule {}
