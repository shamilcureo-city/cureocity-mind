import { NextResponse, type NextRequest } from 'next/server';
import type { ClinicMetricsResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { clinicRoleOf, isClinicAdminRole } from '@/lib/clinic';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clinics/[id]/metrics — per-member aggregate counts for an
 * OWNER/ADMIN. Counts only (active clients, sessions) — never client names
 * or clinical content. This is the one cross-therapist read Phase 2 allows,
 * and it returns nothing identifiable.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clinicId } = await params;

  const myRole = await clinicRoleOf(clinicId, auth.value.psychologistId);
  if (!myRole) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
  if (!isClinicAdminRole(myRole)) {
    return NextResponse.json(
      { error: 'Only a clinic owner or admin can view clinic metrics.' },
      { status: 403 },
    );
  }

  const members = await prisma.clinicMembership.findMany({
    where: { clinicId },
    orderBy: { createdAt: 'asc' },
    include: { psychologist: { select: { id: true, fullName: true } } },
  });
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await Promise.all(
    members.map(async (m) => {
      const pid = m.psychologistId;
      // Sprint 48 — demo "Example" clients never count in clinic rollups.
      const [activeClients, sessions30d, sessionsLifetime] = await Promise.all([
        prisma.client.count({
          where: {
            psychologistId: pid,
            status: 'ACTIVE',
            deletedAt: null,
            isDemo: false,
          },
        }),
        prisma.session.count({
          where: {
            psychologistId: pid,
            status: 'COMPLETED',
            endedAt: { gte: since30d },
            client: { isDemo: false },
          },
        }),
        prisma.session.count({
          where: {
            psychologistId: pid,
            status: 'COMPLETED',
            client: { isDemo: false },
          },
        }),
      ]);
      return {
        psychologistId: pid,
        fullName: m.psychologist.fullName,
        role: m.role,
        activeClients,
        sessions30d,
        sessionsLifetime,
      };
    }),
  );

  const body: ClinicMetricsResponse = { clinicId, members: rows };
  return NextResponse.json(body);
}
