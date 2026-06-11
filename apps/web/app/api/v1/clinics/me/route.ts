import { NextResponse, type NextRequest } from 'next/server';
import type { MyClinicsResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { ensurePersonalClinic, toClinic } from '@/lib/clinic';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clinics/me — the therapist's clinic(s) with members.
 *
 * Lazily ensures a personal clinic exists (self-healing for seeded
 * fixtures / backfill gaps), then returns every clinic the therapist
 * belongs to from their own role's vantage point.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const pid = auth.value.psychologistId;

  const count = await prisma.clinicMembership.count({ where: { psychologistId: pid } });
  if (count === 0) {
    const me = await prisma.psychologist.findUnique({
      where: { id: pid },
      select: { fullName: true },
    });
    await prisma.$transaction((tx) =>
      ensurePersonalClinic(tx, { psychologistId: pid, name: me?.fullName ?? 'My practice' }),
    );
  }

  const memberships = await prisma.clinicMembership.findMany({
    where: { psychologistId: pid },
    orderBy: { createdAt: 'asc' },
    include: {
      clinic: {
        include: {
          memberships: {
            orderBy: { createdAt: 'asc' },
            include: { psychologist: { select: { fullName: true } } },
          },
        },
      },
    },
  });

  const body: MyClinicsResponse = {
    clinics: memberships.map((m) => toClinic(m.clinic, pid)),
  };
  return NextResponse.json(body);
}
