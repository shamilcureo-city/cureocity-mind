import 'reflect-metadata';
import { initObservability } from '@cureocity/observability';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// Bootstrap observability BEFORE NestFactory so auto-instrumentation
// monkey-patches http/pg/redis before any imports use them.
initObservability({
  serviceName: 'patient-model-service',
  prometheusPort: Number(process.env['OTEL_PROMETHEUS_PORT'] ?? 4001),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api/v1');
  // Per-endpoint validation via ZodValidationPipe (see src/common/zod-validation.pipe.ts).
  // No global Nest ValidationPipe — we don't use class-validator decorators.
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen(port);
  Logger.log(`patient-model-service listening on :${port}`, 'Bootstrap');
}

void bootstrap();
