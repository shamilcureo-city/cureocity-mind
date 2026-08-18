import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { LiveAuthorityRequestSchema } from '@cureocity/contracts';
import { getEffectiveCapabilities, serializeCapabilities } from '@/lib/capabilities';
import { writeAudit } from '@/lib/audit';
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

  const session = await prisma.session.findUnique({
    where: { id: body.sessionId },
    select: { psychologistId: true, status: true, captureMode: true },
  });
  const actorPsychologistId = session?.psychologistId ?? body.psychologistId;
  try {
    if (
      !session ||
      session.psychologistId !== body.psychologistId ||
      session.status !== 'IN_PROGRESS' ||
      session.captureMode !== 'LIVE'
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
