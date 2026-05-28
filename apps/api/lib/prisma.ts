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
 * Globally cached on `globalThis` so Next.js HMR doesn't create N
 * clients in dev.
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

export const prisma: PrismaClient = globalThis.__cureocityPrisma ?? build();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__cureocityPrisma = prisma;
}
