import { neonConfig, Pool } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';

/**
 * Prisma client for Vercel Functions.
 *
 * Vercel's serverless runtime spawns short-lived Node processes — a
 * "normal" PrismaClient pool with a few open TCP connections would
 * quickly exhaust Postgres `max_connections` at any real concurrency.
 * The Neon HTTP/serverless driver instead multiplexes over HTTP per
 * request, which fits the serverless model.
 *
 * Local dev: same code path — Vercel Postgres = Neon under the hood,
 * so we use Neon's URL format everywhere.
 *
 * Lazy initialisation: Next.js's "Collecting page data" build step
 * imports every route module to read static metadata. DATABASE_URL is
 * a runtime env var, not a build-time one, so constructing the client
 * eagerly at import would throw during build. The Proxy below defers
 * PrismaClient construction until the first property access — which
 * only happens when a request handler actually queries the DB.
 *
 * Globally cached on `globalThis` so Next.js HMR + warm Vercel
 * function reuse don't create N clients.
 */

neonConfig.webSocketConstructor = ws;

declare global {
  var __cureocityPrisma: PrismaClient | undefined;
}

function build(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
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
