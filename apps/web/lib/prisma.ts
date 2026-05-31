import { PrismaClient } from '@prisma/client';

/**
 * Prisma client for the Vercel BFF (Node.js runtime).
 *
 * History / why this is NOT the Neon serverless driver adapter:
 *   We previously used `@prisma/adapter-neon` (PrismaNeon over a Neon
 *   serverless Pool). That adapter routes interactive transactions
 *   (`prisma.$transaction(async (tx) => …)`) through `pool.connect()`,
 *   which requires a *WebSocket* session. In this Vercel+Neon
 *   deployment the WebSocket transport is unreliable ("Connection
 *   terminated unexpectedly"), which is why simple queries were forced
 *   onto Neon's HTTP/fetch transport (`poolQueryViaFetch = true`).
 *   But `poolQueryViaFetch` does NOT cover `pool.connect()`, and Neon's
 *   pure-HTTP adapter explicitly rejects transactions
 *   ("Transactions are not supported in HTTP mode"). Net result: every
 *   one of the ~24 write routes that wraps its writes in an interactive
 *   transaction 500'd the moment it was first exercised in production.
 *
 *   Prisma's native query engine talks to Postgres over a normal TCP
 *   connection and supports interactive transactions natively — no
 *   WebSocket, no HTTP-mode limitation. All routes here run on the
 *   Node.js runtime (`export const runtime = 'nodejs'`), so the native
 *   engine is the right, reliable choice. The engine binary is already
 *   bundled (Prisma 5 uses it for query planning even under
 *   driverAdapters), and `@prisma/client` is listed in
 *   next.config.js `serverExternalPackages` so Vercel ships the engine
 *   in the function output.
 *
 * Connection string:
 *   Prefer POSTGRES_PRISMA_URL — the Vercel-Neon integration formats it
 *   for Prisma (pooled host + `pgbouncer=true`), which is exactly what
 *   the native engine needs to run interactive transactions through
 *   PgBouncer's transaction-pooling mode. We fall back through the
 *   other Vercel-Neon / manual variants and defensively ensure a pooled
 *   ("-pooler") host carries `pgbouncer=true`.
 *
 * Lazy initialisation: Next.js's "Collecting page data" build step
 * imports every route module to read static metadata. The connection
 * string is a runtime env var, so we defer client construction behind a
 * Proxy until the first property access (i.e. the first real query).
 * Cached on globalThis so HMR + warm Vercel function reuse don't spawn
 * N clients.
 */

declare global {
  var __cureocityPrisma: PrismaClient | undefined;
}

/**
 * PgBouncer (transaction pooling) can't share prepared statements across
 * connections; Prisma must be told to skip them via `pgbouncer=true`.
 * Vercel's POSTGRES_PRISMA_URL already includes it, but if we fall back
 * to a raw pooled URL we add it ourselves. Direct (non-pooler) hosts are
 * left untouched.
 */
function normaliseConnectionString(raw: string): string {
  try {
    const url = new URL(raw);
    const isPooled = url.hostname.includes('-pooler');
    if (isPooled && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    return url.toString();
  } catch {
    // Not a parseable URL (shouldn't happen) — hand it back as-is.
    return raw;
  }
}

function resolveConnectionString(): string {
  const candidate =
    process.env['POSTGRES_PRISMA_URL'] ??
    process.env['DATABASE_URL'] ??
    process.env['POSTGRES_URL'] ??
    process.env['DATABASE_URL_UNPOOLED'] ??
    process.env['POSTGRES_URL_NON_POOLING'];
  if (!candidate) {
    throw new Error(
      'No database connection string set (looked for POSTGRES_PRISMA_URL, DATABASE_URL, POSTGRES_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING)',
    );
  }
  return normaliseConnectionString(candidate);
}

function build(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: resolveConnectionString() } },
  });
}

let cached: PrismaClient | undefined;
function getClient(): PrismaClient {
  if (cached) return cached;
  if (globalThis.__cureocityPrisma) {
    cached = globalThis.__cureocityPrisma;
    return cached;
  }
  cached = build();
  if (process.env['NODE_ENV'] !== 'production') {
    globalThis.__cureocityPrisma = cached;
  }
  return cached;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
