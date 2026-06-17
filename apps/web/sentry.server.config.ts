/**
 * Sentry Node-runtime config. Loaded by `instrumentation.ts` when
 * `NEXT_RUNTIME === 'nodejs'`.
 *
 * Enabled only when VERCEL_ENV is set (preview + production); local
 * dev stays silent so a test exception doesn't pollute the dashboard.
 */
import * as Sentry from '@sentry/nextjs';

const DEFAULT_DSN =
  'https://9882c32602cad4f86c9c4b85a160b246@o4511364925095936.ingest.us.sentry.io/4511581385392128';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? DEFAULT_DSN,
  enabled: !!process.env['VERCEL_ENV'],
  environment: process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'],
  // Capture 10 % of transactions in prod, all of them in preview, for
  // a usable trace sample without blowing through the free-tier quota.
  tracesSampleRate: process.env['VERCEL_ENV'] === 'production' ? 0.1 : 1.0,
  // Sensitive — the SOAP / clinical-brief payloads can hit Sentry as
  // request bodies on a route exception. Off until we have a DPDP
  // review of what Sentry retains.
  sendDefaultPii: false,
});
