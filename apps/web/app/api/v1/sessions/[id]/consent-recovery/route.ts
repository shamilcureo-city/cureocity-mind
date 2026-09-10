import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  MindConsentRecoveryInputSchema,
} from '@/lib/mind-consent-recovery';
import {
  MindConsentRecoveryConflict,
  MAX_RECOVERY_SNAPSHOT_ENTRIES,
  consentRecoveryHash,
  consentSnapshotAuditMetadata,
  isCurrentRecoveryGrant,
  readRecoverySnapshot,
  recoveryState,
} from '@/lib/mind-consent-recovery-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
const missing = () => NextResponse.json({ error: 'Session not found' }, { status: 404, headers });

async function authorize(req: NextRequest) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth;
  const live = await requireCapability(req, 'LIVE_ENCOUNTER', auth);
  if (!live.ok) return live;
  return requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', live);
}

async function readLockedSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  psychologistId: string,
) {
  const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
  // Lock in global Client -> Session order. Lifecycle writers that only lock
  // the Session cannot race the final eligibility check and snapshot update.
  await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
  const session = await tx.session.findFirst({
    where: {
      id: sessionId,
      clientId: client.id,
      psychologistId,
      psychologist: { vertical: 'THERAPIST' },
      client: { is: { deletedAt: null } },
    },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      consentSnapshot: true,
      // Any previous signature closes recovery, including an unlocked note.
      therapyNote: { select: { id: true } },
    },
  });
  if (!session) throw new ClientPhiWriteForbiddenError();
  return session;
}

const readStanding = (tx: Prisma.TransactionClient, clientId: string) =>
  tx.consent.findMany({
    where: { clientId, scope: { in: [...MIND_CONSENT_RECOVERY_SCOPES] } },
    select: {
      id: true,
      scope: true,
      status: true,
      scriptVersion: true,
      capturedVia: true,
      grantedAt: true,
      withdrawnAt: true,
      expiresAt: true,
      updatedAt: true,
    },
  });

function errorResponse(error: unknown): NextResponse | null {
  if (error instanceof ClientPhiWriteForbiddenError) return missing();
  if (error instanceof MindConsentRecoveryConflict)
    return NextResponse.json(
      { error: error.message, code: 'MIND_CONSENT_RECOVERY_CONFLICT' },
      { status: 409, headers },
    );
  return null;
}

/** No token/start side effects: inspect only the exact owned Mind session. */
export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  try {
    const state = await prisma.$transaction(async (tx) => {
      const session = await readLockedSession(tx, sessionId, auth.value.psychologistId);
      return recoveryState(session, await readStanding(tx, session.clientId), new Date());
    });
    return NextResponse.json(state, { headers });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    throw error;
  }
}

/** Explicit prospective confirmation. Never authorizes previously captured material. */
export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, MindConsentRecoveryInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;
  const { id: sessionId } = await ctx.params;
  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const session = await readLockedSession(tx, sessionId, auth.value.psychologistId);
      const standing = await readStanding(tx, session.clientId);
      const now = new Date();
      const before = recoveryState(session, standing, now);
      const requestHash = consentRecoveryHash(input);
      const previous = await tx.auditLog.findFirst({
        where: {
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_CONSENT_RECORDED',
          targetType: 'Session',
          targetId: sessionId,
          AND: [
            { metadata: { path: ['source'], equals: 'MIND_CONSENT_RECOVERY' } },
            { metadata: { path: ['operationId'], equals: input.operationId } },
          ],
        },
        select: { metadata: true },
      });
      if (previous) {
        const metadata = previous.metadata as Record<string, unknown> | null;
        // A lost-ack retry may acknowledge only its own unchanged committed
        // result. Later withdrawal, expiry, correction or lifecycle changes
        // must not be overwritten and must not return a false ready receipt.
        if (
          metadata?.recoveryVersion !== 1 ||
          metadata.requestHash !== requestHash ||
          metadata.resultRevision !== before.revision ||
          !before.ready
        )
          throw new MindConsentRecoveryConflict();
        return { ...before, operationId: input.operationId, replayed: true };
      }
      if (input.expectedRevision !== before.revision) throw new MindConsentRecoveryConflict();
      const previousSnapshot = readRecoverySnapshot(session.consentSnapshot);
      if (
        previousSnapshot.entries.length + MIND_CONSENT_RECOVERY_SCOPES.length >
        MAX_RECOVERY_SNAPSHOT_ENTRIES
      )
        throw new MindConsentRecoveryConflict(
          'This consent history needs support review. Existing acknowledgements have been kept.',
        );
      const confirmedAt = now.toISOString();
      const snapshot = {
        ...previousSnapshot,
        entries: [
          ...previousSnapshot.entries,
          ...MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
            scope,
            scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
            ackedAt: confirmedAt,
          })),
        ],
      };
      // Retain old withdrawn/expired rows as history. A fresh explicit
      // confirmation may create a new grant, but never refresh optional
      // extended-retention consent or revive an old grant in place.
      for (const scope of MIND_CONSENT_RECOVERY_SCOPES) {
        if (standing.some((row) => row.scope === scope && isCurrentRecoveryGrant(row, now)))
          continue;
        const grant = await tx.consent.create({
          data: {
            clientId: session.clientId,
            psychologistId: auth.value.psychologistId,
            scope,
            status: 'GRANTED',
            scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
            capturedVia: 'IN_PERSON',
            grantedAt: now,
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'CONSENT_GRANTED',
            targetType: 'Consent',
            targetId: grant.id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId: session.clientId,
              sessionId,
              scope,
              source: 'MIND_CONSENT_RECOVERY',
              operationId: input.operationId,
              authorizationAppliesFrom: confirmedAt,
              authorizesPreviousProcessing: false,
            },
          },
          tx,
        );
      }
      await tx.session.update({
        where: { id: sessionId },
        data: { consentSnapshot: snapshot },
      });
      const after = recoveryState(
        { ...session, consentSnapshot: snapshot },
        await readStanding(tx, session.clientId),
        new Date(),
      );
      // For example a pre-existing grant might expire during persistence.
      // Roll the entire transaction back, rather than claiming ready.
      if (!after.ready) throw new MindConsentRecoveryConflict();
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_CONSENT_RECORDED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: session.clientId,
            source: 'MIND_CONSENT_RECOVERY',
            recoveryVersion: 1,
            operationId: input.operationId,
            requestHash,
            previousRevision: before.revision,
            resultRevision: after.revision,
            previousSnapshot: consentSnapshotAuditMetadata(previousSnapshot),
            previousSnapshotHash: consentRecoveryHash(session.consentSnapshot),
            confirmedScopes: [...MIND_CONSENT_RECOVERY_SCOPES],
            scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
            authorizationAppliesFrom: confirmedAt,
            authorizesPreviousProcessing: false,
          },
        },
        tx,
      );
      return { ...after, operationId: input.operationId, replayed: false };
    });
    return NextResponse.json(receipt, { headers });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    throw error;
  }
}
