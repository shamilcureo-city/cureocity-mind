import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toBooking } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBookingSchema = z.object({
  therapistId: z.string().min(1),
  patientName: z.string().min(1).max(120),
  patientEmail: z.string().email(),
  patientPhone: z.string().min(6).max(32),
  preferredAt: z.string().datetime(),
  message: z.string().max(2000).optional(),
});

/** POST /api/v1/bookings — public; no auth required (visitor flow). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const input = await parseJson(req, CreateBookingSchema);
  if (!input.ok) return input.response;

  const therapist = await prisma.psychologist.findFirst({
    where: {
      id: input.value.therapistId,
      deletedAt: null,
      status: 'ACTIVE',
      bio: { not: null },
    },
    select: { id: true },
  });
  if (!therapist) {
    return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.booking.create({
      data: {
        therapistId: input.value.therapistId,
        patientName: input.value.patientName,
        patientEmail: input.value.patientEmail,
        patientPhone: input.value.patientPhone,
        preferredAt: new Date(input.value.preferredAt),
        ...(input.value.message !== undefined && { message: input.value.message }),
      },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'BOOKING_REQUESTED',
        targetType: 'Booking',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          therapistId: input.value.therapistId,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toBooking(created), { status: 201 });
}

/** GET /api/v1/bookings — therapist-scoped list. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const rows = await prisma.booking.findMany({
    where: {
      therapistId: auth.value.psychologistId,
      ...(status ? { status: status as 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ bookings: rows.map(toBooking), count: rows.length });
}
