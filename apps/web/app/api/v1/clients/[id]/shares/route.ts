import { NextResponse, type NextRequest } from 'next/server';
import { ListPatientSharesQuerySchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { toPatientShare } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/shares
 *
 * Returns the patient-share history for one client, newest first.
 * Used by the therapist's client detail page to surface what was
 * sent + opened.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const query = parseQuery(req.url, ListPatientSharesQuerySchema);
  if (!query.ok) return query.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const rows = await prisma.patientShare.findMany({
    where: { clientId, psychologistId: auth.value.psychologistId },
    orderBy: { createdAt: 'desc' },
    take: query.value.limit,
  });
  return NextResponse.json({ items: rows.map(toPatientShare) });
}
