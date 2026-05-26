import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3005);
  await app.listen(port);
  Logger.log(`continuity-service listening on :${port}`, 'Bootstrap');
}

void bootstrap();
