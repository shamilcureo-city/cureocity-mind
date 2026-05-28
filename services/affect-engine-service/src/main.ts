import 'reflect-metadata';
import { initObservability } from '@cureocity/observability';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

initObservability({
  serviceName: 'affect-engine-service',
  prometheusPort: Number(process.env['OTEL_PROMETHEUS_PORT'] ?? 4004),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3004);
  await app.listen(port);
  Logger.log(`affect-engine-service listening on :${port}`, 'Bootstrap');
}

void bootstrap();
