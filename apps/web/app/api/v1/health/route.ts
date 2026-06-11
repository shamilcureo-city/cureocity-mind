import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { firebaseAuth } from '@/lib/firebase-admin';
import { isAuthBypassed } from '@/lib/auth-server';

/**
 * Health + readiness endpoint.
 *
 * Base behaviour (unchanged, used by Vercel's health probe): verifies
 * the Postgres adapter is reachable. 200 `status: ok` when reachable,
 * 503 `status: degraded` otherwise.
 *
 * Sprint 36 — also returns a `config` topology readout so an operator
 * can answer "is this deploy actually wired?" without reading logs. It
 * reports booleans + backend names only — never secret values — and is
 * derived from env without initialising any backend (no side effects).
 *
 * Exposure: the `config` block is open in dev/preview. In production set
 * `HEALTH_CHECK_TOKEN`; callers must then pass it as `x-health-token`
 * (or `?token=`) to see `config`. The base status/200/503 stays public
 * for the probe regardless.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function configReadout() {
  return {
    databaseUrlSet: Boolean(process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_UNPOOLED']),
    auth: {
      firebaseAdmin: firebaseAuth() !== null,
      firebaseClient: Boolean(process.env['NEXT_PUBLIC_FIREBASE_API_KEY']),
      bypassActive: isAuthBypassed(),
    },
    kmsBackend: process.env['KMS_BACKEND'] ?? 'local-dev',
    llmBackend: process.env['LLM_BACKEND'] ?? 'mock',
    channels: {
      sendgrid: Boolean(process.env['SENDGRID_API_KEY'] && process.env['SENDGRID_FROM_EMAIL']),
      wati: Boolean(process.env['WATI_BEARER_TOKEN'] && process.env['WATI_API_BASE']),
    },
    webauthn: {
      rpId: process.env['WEBAUTHN_RP_ID'] ?? '(request hostname)',
      originsPinned: Boolean(process.env['WEBAUTHN_ORIGINS']),
    },
    pilotInviteRequired: process.env['PILOT_INVITE_REQUIRED'] === 'true',
    observabilityForwarding: Boolean(process.env['OBSERVABILITY_WEBHOOK_URL']),
    vercelEnv: process.env['VERCEL_ENV'] ?? 'local',
  };
}

function configAuthorized(req: NextRequest): boolean {
  const token = process.env['HEALTH_CHECK_TOKEN'];
  if (!token) return true; // open in dev/preview where no token is set
  const provided =
    req.headers.get('x-health-token') ?? new URL(req.url).searchParams.get('token') ?? '';
  return provided === token;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let dbOk = true;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    dbOk = false;
    dbError = (e as Error).message;
  }

  const body: Record<string, unknown> = {
    status: dbOk ? 'ok' : 'degraded',
    service: 'cureocity-api',
  };
  if (!dbOk) body['error'] = dbError;
  if (configAuthorized(req)) body['config'] = configReadout();

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
