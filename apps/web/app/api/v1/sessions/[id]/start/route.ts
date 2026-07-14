import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/start — transitions SCHEDULED → IN_PROGRESS.
 * Refuses without a recorded consent snapshot.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'SCHEDULED') {
    return NextResponse.json(
      { error: `Cannot start a session in ${existing.status} state` },
      { status: 400 },
    );
  }
  if (existing.consentSnapshot === null) {
    return NextResponse.json(
      { error: 'Session consent must be recorded before starting' },
      { status: 400 },
    );
  }
  // PROD5 (DPDP) — Pass 2–5 process the transcript on Google's GLOBAL
  // endpoint, so a session may only start when the snapshot carries the
  // cross-border scope. docs/dpdp-data-flow.md declares this mandatory;
  // this is the gate that makes the claim true.
  const snapshotScopes = new Set(
    ((existing.consentSnapshot as { entries?: Array<{ scope?: string }> }).entries ?? []).map(
      (e) => e.scope,
    ),
  );
  if (!snapshotScopes.has('CROSS_BORDER_PROCESSING')) {
    return NextResponse.json(
      {
        error:
          'AI note analysis processes the transcript outside India, and this client has not ' +
          'consented to cross-border processing. Capture that consent in the pre-session ' +
          'consent step before starting an AI-scribed session.',
      },
      { status: 409 },
    );
  }

  // DS11.7 — the doctor capture surfaces declare their pipeline. Optional
  // body; therapist callers send none and captureMode stays null.
  const body = (await req.json().catch(() => null)) as { captureMode?: string } | null;
  const captureMode =
    body?.captureMode === 'DICTATE' || body?.captureMode === 'UPLOAD' ? body.captureMode : null;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.session.update({
      where: { id: sessionId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        ...(captureMode && { captureMode }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_STARTED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: auditMetadataFromRequest(req),
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toSession(updated));
}
