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
  ],
};

module.exports = nextConfig;
