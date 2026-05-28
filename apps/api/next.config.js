/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API app has no UI; React is only a peer for Next's compiler.
  // Packages listed here are NOT bundled by webpack — they're require()'d
  // at runtime from node_modules. Critical for Prisma (native engines),
  // firebase-admin (gRPC native bits), and the OpenTelemetry
  // auto-instrumentation graph (optional peer deps that webpack can't
  // statically resolve).
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
