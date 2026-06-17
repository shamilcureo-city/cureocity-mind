/**
 * Sentry browser config. Loaded automatically by `withSentryConfig`
 * for Next 15.1 client bundles. (Next 15.3+ uses `instrumentation-client.ts`;
 * if we upgrade, move this content there.)
 *
 * Session Replay is OFF: clinical UI surfaces patient data inline
 * (note transcripts, clinical brief, etc.) and even masked replays
 * would round-trip that through Sentry. Off until a DPDP review.
 */
import * as Sentry from '@sentry/nextjs';

const DEFAULT_DSN =
  'https://9882c32602cad4f86c9c4b85a160b246@o4511364925095936.ingest.us.sentry.io/4511581385392128';

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? DEFAULT_DSN,
  enabled: !!process.env['NEXT_PUBLIC_VERCEL_ENV'],
  environment: process.env['NEXT_PUBLIC_VERCEL_ENV'] ?? 'development',
  tracesSampleRate: process.env['NEXT_PUBLIC_VERCEL_ENV'] === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
  // No replay integration on purpose — clinical content stays out of Sentry.
});
