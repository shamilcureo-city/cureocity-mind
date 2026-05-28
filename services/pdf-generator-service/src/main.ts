import 'reflect-metadata';
import { initObservability } from '@cureocity/observability';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

initObservability({
  serviceName: 'pdf-generator-service',
  prometheusPort: Number(process.env['OTEL_PROMETHEUS_PORT'] ?? 4006),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3006);
  await app.listen(port);
  Logger.log(`pdf-generator-service listening on :${port}`, 'Bootstrap');
}

void bootstrap();
