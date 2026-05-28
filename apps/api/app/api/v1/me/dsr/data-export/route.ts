import { NextResponse, type NextRequest } from 'next/server';
import type { DsrDataExport } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me/dsr/data-export — DPDP § 11 access. Aggregates the
 * client's entire footprint into a single payload. Counts only for
 * volumetric tables (sessions, mood, journal, exercises) to keep
 * response size bounded.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const clientId = auth.value.clientId;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
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
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const [sessionCount, moodLogCount, journalEntryCount, exerciseAssignmentCount] =
    await Promise.all([
      prisma.session.count({ where: { clientId } }),
      prisma.moodLog.count({ where: { clientId } }),
      prisma.journalEntry.count({ where: { clientId } }),
      prisma.exerciseAssignment.count({ where: { clientId } }),
    ]);

  await writeAudit({
    actorType: 'CLIENT',
    action: 'DSR_ACCESS_FULFILLED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      sessionCount,
      moodLogCount,
      journalEntryCount,
      exerciseAssignmentCount,
    },
  });

  const body: DsrDataExport = {
    exportedAt: new Date().toISOString(),
    client: {
      id: client.id,
      fullName: client.fullName,
      contactPhone: client.contactPhone,
      contactEmail: client.contactEmail,
      dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
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
      withdrawnAt: c.withdrawnAt ? c.withdrawnAt.toISOString() : null,
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
      supersededAt: n.supersededAt ? n.supersededAt.toISOString() : null,
    })),
    erasureRequests: client.erasureRequests.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    })),
    grievances: client.grievances.map((g) => ({
      id: g.id,
      subject: g.subject,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      resolvedAt: g.resolvedAt ? g.resolvedAt.toISOString() : null,
    })),
  };
  return NextResponse.json(body);
}
