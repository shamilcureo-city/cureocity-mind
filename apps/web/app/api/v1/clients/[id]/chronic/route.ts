import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { buildChronicTrajectory } from '@/lib/chronic-trajectory';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DV7 — GET /api/v1/clients/:id/chronic
 *
 * The per-patient chronic-disease control trajectory (BP / HbA1c / FBS /
 * LDL / weight): the reading series + the deterministic control + trend
 * verdict per measure. Tenant-checked (404 cross-tenant non-leak).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  const trajectory = await buildChronicTrajectory(clientId, auth.value.psychologistId);
  return NextResponse.json(trajectory);
}
