import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { LiveAuthorityRequestSchema } from '@cureocity/contracts';
import { getEffectiveCapabilities, serializeCapabilities } from '@/lib/capabilities';
import { writeAudit } from '@/lib/audit';
import { SCRIBE_CONSENT_SCOPES } from '@/lib/consent-gate';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trusted service-to-service revalidation for the standalone live gateway.
 * The request intentionally contains only opaque database identifiers: never
 * patient context, transcript, note content, or the practitioner's live token.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!hasServiceSecret(req)) {
    return NextResponse.json({ authorized: false, capabilities: [] }, { status: 401 });
  }

  const parsed = await parseJson(req, LiveAuthorityRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const { session, currentConsentScopes } = await prisma.$transaction(
    async (tx) => {
      const currentSession = await tx.session.findUnique({
        where: { id: body.sessionId },
        select: {
          psychologistId: true,
          status: true,
          captureMode: true,
          clientId: true,
          psychologist: { select: { vertical: true } },
        },
      });
      if (!currentSession) return { session: null, currentConsentScopes: new Set<string>() };

      // Read lifecycle + all standing consent grants from one serializable,
      // current server-side snapshot. Expired, withdrawn, and absent grants
      // are all denials; the historical Session snapshot is audit evidence,
      // never continuing authority.
      const consents = await tx.consent.findMany({
        where: {
          clientId: currentSession.clientId,
          scope: { in: [...SCRIBE_CONSENT_SCOPES] },
          status: 'GRANTED',
          withdrawnAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { scope: true },
      });
      return {
        session: currentSession,
        currentConsentScopes: new Set(consents.map((consent) => consent.scope)),
      };
    },
    { isolationLevel: 'Serializable' },
  );
  const actorPsychologistId = session?.psychologistId ?? body.psychologistId;
  try {
    if (
      !session ||
      session.psychologistId !== body.psychologistId ||
      session.psychologist.vertical !== body.vertical ||
      body.tokenExpiresAt <= Math.floor(Date.now() / 1_000) ||
      session.status !== 'IN_PROGRESS' ||
      session.captureMode !== 'LIVE' ||
      SCRIBE_CONSENT_SCOPES.some((scope) => !currentConsentScopes.has(scope))
    ) {
      throw new Error('denied');
    }
    const effective = await getEffectiveCapabilities(session.psychologistId);
    return NextResponse.json({
      authorized: true,
      capabilities: serializeCapabilities(effective),
    });
  } catch {
    try {
      await writeAudit({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId,
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'LiveAuthority',
        targetId: 'DENIED',
        metadata: { source: 'liveGatewayRevalidation', sessionId: body.sessionId },
      });
    } catch {
      // Authority denial is mandatory; audit persistence is best effort.
      console.error('[live-authority] Failed to persist authority-denial audit event.');
    }
    return NextResponse.json({ authorized: false, capabilities: [] }, { status: 403 });
  }
}

function hasServiceSecret(req: NextRequest): boolean {
  const expected = process.env['LIVE_GATEWAY_SECRET'];
  const authorization = req.headers.get('authorization');
  if (!expected || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
