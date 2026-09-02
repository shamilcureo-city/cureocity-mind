import { NextResponse, type NextRequest } from 'next/server';
import { ListPatientSharesQuerySchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';

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
  if (!auth.ok) return privateResponse(auth.response);
  const { id: clientId } = await params;
  const query = parseQuery(req.url, ListPatientSharesQuerySchema);
  if (!query.ok) return privateResponse(query.response);

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return privateJson({ error: 'Client not found' }, { status: 404 });
  }

  const [rows, lastSuccessful] = await Promise.all([
    prisma.patientShare.findMany({
      where: { clientId, psychologistId: auth.value.psychologistId },
      orderBy: { createdAt: 'desc' },
      take: query.value.limit,
      select: { id: true, channel: true, status: true, sentAt: true, createdAt: true },
    }),
    prisma.patientShare.findFirst({
      where: {
        clientId,
        psychologistId: auth.value.psychologistId,
        status: { in: ['SENT', 'OPENED'] },
        sentAt: { not: null },
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { channel: true },
    }),
  ]);
  return privateJson({
    items: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      status: row.status,
      sentAt: row.sentAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    lastSuccessfulChannel: lastSuccessful?.channel ?? null,
  });
}

function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers).entries()),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function privateResponse(response: Response): NextResponse {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
