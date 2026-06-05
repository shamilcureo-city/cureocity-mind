import { NextResponse, type NextRequest } from 'next/server';
import type { DsrDataExport } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/dsr/data-export — DPDP § 11 Right to
 * Access. Returns a structured JSON snapshot of everything the data
 * fiduciary holds on this client: profile, consent history,
 * nominations, erasure requests, grievances, plus counts for
 * session / mood / journal / exercise data (the full content of
 * those is exported separately because size).
 *
 * Therapist-facing: the therapist acts on behalf of the client to
 * fulfill an access request received via email, phone, or in
 * person. Audit row records actor as PSYCHOLOGIST so the regulator
 * can distinguish therapist-fulfilled from client-self-initiated
 * exports (the latter ships with the client-web PWA).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    include: {
      psychologist: { select: { id: true, fullName: true, email: true } },
      consents: {
        orderBy: { grantedAt: 'desc' },
        select: {
          scope: true,
          status: true,
          scriptVersion: true,
          grantedAt: true,
          withdrawnAt: true,
        },
      },
      nominations: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          nomineeName: true,
          nomineeRelation: true,
          createdAt: true,
          supersededAt: true,
        },
      },
      erasureRequests: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, createdAt: true, resolvedAt: true },
      },
      grievances: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
        },
      },
    },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [sessionCount, moodLogCount, journalEntryCount, exerciseAssignmentCount] =
    await Promise.all([
      prisma.session.count({ where: { clientId } }),
      prisma.moodLog.count({ where: { clientId } }),
      prisma.journalEntry.count({ where: { clientId } }),
      prisma.exerciseAssignment.count({ where: { clientId } }),
    ]);

  const exportedAt = new Date().toISOString();

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'DSR_ACCESS_FULFILLED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      onBehalfOf: clientId,
    },
  });

  const body: DsrDataExport = {
    exportedAt,
    client: {
      id: client.id,
      fullName: client.fullName,
      contactPhone: client.contactPhone,
      contactEmail: client.contactEmail,
      dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      presentingConcerns: client.presentingConcerns,
      preferredModality: client.preferredModality,
      status: client.status,
      createdAt: client.createdAt.toISOString(),
    },
    psychologist: {
      id: client.psychologist.id,
      fullName: client.psychologist.fullName,
      email: client.psychologist.email,
    },
    consents: client.consents.map((c) => ({
      scope: c.scope,
      status: c.status,
      scriptVersion: c.scriptVersion,
      grantedAt: c.grantedAt.toISOString(),
      withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
    })),
    sessionCount,
    moodLogCount,
    journalEntryCount,
    exerciseAssignmentCount,
    nominations: client.nominations.map((n) => ({
      id: n.id,
      nomineeName: n.nomineeName,
      nomineeRelation: n.nomineeRelation,
      createdAt: n.createdAt.toISOString(),
      supersededAt: n.supersededAt?.toISOString() ?? null,
    })),
    erasureRequests: client.erasureRequests.map((e) => ({
      id: e.id,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
      resolvedAt: e.resolvedAt?.toISOString() ?? null,
    })),
    grievances: client.grievances.map((g) => ({
      id: g.id,
      subject: g.subject,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      resolvedAt: g.resolvedAt?.toISOString() ?? null,
    })),
  };

  return NextResponse.json(body, {
    headers: {
      'Content-Disposition': `attachment; filename="dsr-export-${clientId.slice(0, 8)}-${exportedAt.slice(0, 10)}.json"`,
    },
  });
}
