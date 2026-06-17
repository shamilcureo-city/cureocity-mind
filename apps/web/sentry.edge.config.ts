/**
 * Sentry Edge-runtime config. Loaded by `instrumentation.ts` when
 * `NEXT_RUNTIME === 'edge'`. Currently every route is `runtime = 'nodejs'`
 * (see CLAUDE.md — Vertex SDK doesn't run on edge), but middleware
 * still runs on edge, so this catches errors there.
 */
import * as Sentry from '@sentry/nextjs';

const DEFAULT_DSN =
  'https://9882c32602cad4f86c9c4b85a160b246@o4511364925095936.ingest.us.sentry.io/4511581385392128';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? DEFAULT_DSN,
  enabled: !!process.env['VERCEL_ENV'],
  environment: process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'],
  tracesSampleRate: process.env['VERCEL_ENV'] === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
});
