import { NextResponse, type NextRequest } from 'next/server';
import { SessionConsentAckInputSchema, type SessionConsentSnapshot } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';
import {
  conditionalSessionTransition,
  sessionConcurrentModificationResponse,
} from '@/lib/session-transition';
import { withClientConsentLock } from '@/lib/consent-gate';
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

  // PROD5 — a scope acked here that the client has no standing consent for
  // (e.g. CROSS_BORDER_PROCESSING ticked in the pre-flight because it was
  // missed at client creation) is persisted as a client-level Consent row,
  // so the pre-flight asks at most once and /start's cross-border gate sees
  // a durable record — not just this session's snapshot.
  let updated;
  try {
    updated = await prisma.$transaction((tx) =>
      withClientConsentLock(tx, existing.clientId, async () => {
        const standing = await tx.consent.findMany({
          where: {
            clientId: existing.clientId,
            scope: { in: dto.value.scopes },
            status: 'GRANTED',
            withdrawnAt: null,
          },
          select: { scope: true },
        });
        const standingScopes = new Set(standing.map((consent) => consent.scope));
        const newScopes = dto.value.scopes.filter((scope) => !standingScopes.has(scope));
        const row = await conditionalSessionTransition(tx, {
          sessionId,
          expectedStatus: 'SCHEDULED',
          data: { consentSnapshot: snapshot },
        });
        for (const scope of newScopes) {
          const consentRow = await tx.consent.create({
            data: {
              clientId: existing.clientId,
              psychologistId: auth.value.psychologistId,
              scope,
              status: 'GRANTED',
              scriptVersion: dto.value.scriptVersion,
              capturedVia: 'IN_PERSON',
              grantedAt: new Date(),
              notes: `Captured in the pre-session consent step (session ${sessionId})`,
            },
          });
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: auth.value.psychologistId,
              action: 'CONSENT_GRANTED',
              targetType: 'Consent',
              targetId: consentRow.id,
              metadata: {
                ...auditMetadataFromRequest(req),
                scope,
                clientId: existing.clientId,
                source: 'SESSION_PRE_FLIGHT',
              },
            },
            tx,
          );
        }
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
      }),
    );
  } catch (error) {
    const response = sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }
  return NextResponse.json(toSession(updated));
}
