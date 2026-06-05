import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/erasure-queue — therapist-scoped queue of
 * ClientErasureRequest rows that need review. In V1 the "admin"
 * is the same psychologist who owns the client; once a multi-
 * therapist clinic / supervisor role lands (Sprint 10), this
 * widens to include role-grant scope.
 *
 * Returns the request + a minimal Client header so the queue UI
 * can render rows without a second lookup.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.getAll('status');
  const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED'] as const;
  const statuses = statusParam.filter((s): s is (typeof allowed)[number] =>
    (allowed as readonly string[]).includes(s),
  );

  const rows = await prisma.clientErasureRequest.findMany({
    where: {
      client: { psychologistId: auth.value.psychologistId },
      ...(statuses.length > 0 ? { status: { in: statuses } } : { status: 'PENDING' }),
    },
    orderBy: { createdAt: 'asc' },
    include: { client: { select: { id: true, fullName: true, status: true } } },
    take: 100,
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolutionNotes: r.resolutionNotes,
      client: {
        id: r.client.id,
        fullName: r.client.fullName,
        status: r.client.status,
      },
    })),
  });
}
