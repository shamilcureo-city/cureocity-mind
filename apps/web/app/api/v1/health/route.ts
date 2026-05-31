import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Health endpoint — ports the pattern from every NestJS service's
 * HealthController. Verifies the Postgres adapter is reachable.
 *
 * Returns 200 with `status: 'ok'` when reachable, 503 with
 * `status: 'degraded'` otherwise. Vercel Functions auto-mark a
 * deployment unhealthy when their /api/v1/health returns non-200.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', service: 'cureocity-api' });
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        service: 'cureocity-api',
        error: (e as Error).message,
      },
      { status: 503 },
    );
  }
}
