import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { RendererModule } from './renderer/renderer.module';
import { PdfsModule } from './pdfs/pdfs.module';
import { DeliveryModule } from './delivery/delivery.module';
import { WhatsAppModule } from './delivery/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    AuditModule,
    HealthModule,
    RendererModule,
    PdfsModule,
    DeliveryModule,
    WhatsAppModule,
  ],
})
export class AppModule {}
