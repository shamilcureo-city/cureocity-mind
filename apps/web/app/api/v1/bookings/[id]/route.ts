import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toBooking } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED', 'CANCELLED']),
  note: z.string().max(1000).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AUDIT_ACTION = {
  ACCEPTED: 'BOOKING_ACCEPTED',
  DECLINED: 'BOOKING_DECLINED',
  CANCELLED: 'BOOKING_CANCELLED',
} as const;

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const input = await parseJson(req, PatchSchema);
  if (!input.ok) return input.response;

  const booking = await prisma.booking.findFirst({
    where: { id, therapistId: auth.value.psychologistId },
  });
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Cannot transition a booking already in ${booking.status}` },
      { status: 400 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.booking.update({
      where: { id },
      data: { status: input.value.status, resolvedAt: new Date() },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: AUDIT_ACTION[input.value.status],
        targetType: 'Booking',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          patientEmail: booking.patientEmail,
          ...(input.value.note !== undefined && { note: input.value.note }),
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toBooking(updated));
}
