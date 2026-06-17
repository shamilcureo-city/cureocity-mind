const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Server-only packages that should not be webpack-bundled into the
  // function output. The Prisma engines + Firebase-admin native bits +
  // OTel auto-instrumentation graph all have optional peer deps that
  // webpack can't statically resolve. Listing them here tells Next.js
  // to require() them at runtime from node_modules instead.
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-neon',
    '@neondatabase/serverless',
    'firebase-admin',
    '@cureocity/observability',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/exporter-metrics-otlp-http',
  ],
};

// Sprint 57 — Sentry. With no SENTRY_AUTH_TOKEN the source-map upload
// step is skipped (build still succeeds, just produces opaque stack
// traces in the Sentry UI). The DSN itself is baked into the Sentry
// config files so runtime init works without any env var; the org +
// project here are only needed by the build-time upload plugin.
module.exports = withSentryConfig(nextConfig, {
  org: 'cureocity-health-tech-llp-di',
  project: 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Routes Sentry browser requests through /monitoring so ad-blockers
  // don't kill them.
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
  // Don't fail the build when the upload step has no token.
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
