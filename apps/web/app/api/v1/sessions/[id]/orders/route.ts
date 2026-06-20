import { NextResponse, type NextRequest } from 'next/server';
import type { SessionOrders } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { toClinicalOrderDTO, toMedicationOrderDTO } from '@/lib/order-mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sprint DV5 — GET /api/v1/sessions/:id/orders
 *
 * The drafted + confirmed Rx (medication orders) and clinical orders
 * (labs / imaging / referrals / procedures) for a doctor encounter.
 * Tenant-checked (404 cross-tenant non-leak). Read-only — no audit.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const [medications, clinicalOrders] = await Promise.all([
    prisma.medicationOrder.findMany({
      where: { sessionId, status: { not: 'DISCARDED' } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.clinicalOrder.findMany({
      where: { sessionId, status: { not: 'DISCARDED' } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const body: SessionOrders = {
    medications: medications.map(toMedicationOrderDTO),
    clinicalOrders: clinicalOrders.map(toClinicalOrderDTO),
  };
  return NextResponse.json(body);
}
