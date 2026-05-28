import { NextResponse, type NextRequest } from 'next/server';
import { SessionConsentAckInputSchema, type SessionConsentSnapshot } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/consent — snapshot the in-session
 * consent ack onto the row. Must be called before /start.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'SCHEDULED') {
    return NextResponse.json(
      { error: `Cannot record consent on a session in ${existing.status} state` },
      { status: 400 },
    );
  }
  const dto = await parseJson(req, SessionConsentAckInputSchema);
  if (!dto.ok) return dto.response;

  const ackedAt = new Date().toISOString();
  const snapshot: SessionConsentSnapshot = {
    entries: dto.value.scopes.map((scope) => ({
      scope,
      scriptVersion: dto.value.scriptVersion,
      ackedAt,
    })),
    notes: dto.value.notes ?? null,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.session.update({
      where: { id: sessionId },
      data: { consentSnapshot: snapshot },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_CONSENT_RECORDED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          scopes: dto.value.scopes,
          scriptVersion: dto.value.scriptVersion,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toSession(updated));
}
