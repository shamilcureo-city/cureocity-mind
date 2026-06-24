import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { LetterPdf } from '@/components/pdf/LetterPdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/letters/[letterId]/pdf — Sprint 66.
 *
 * Renders a previously-composed letter as a credential-stamped PDF and
 * streams it. Read-only; tenant-gated on both the letter's owner and its
 * client. The letterhead name + RCI are re-fetched at render time.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; letterId: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, letterId } = await params;
  const psychologistId = auth.value.psychologistId;

  const letter = await prisma.letter.findUnique({
    where: { id: letterId },
    select: {
      clientId: true,
      psychologistId: true,
      recipient: true,
      subject: true,
      body: true,
      createdAt: true,
    },
  });
  if (!letter || letter.psychologistId !== psychologistId || letter.clientId !== clientId) {
    return NextResponse.json({ error: 'Letter not found' }, { status: 404 });
  }

  const psychologist = await prisma.psychologist.findUnique({
    where: { id: psychologistId },
    select: { fullName: true, rciNumber: true },
  });

  const buffer = await renderToBuffer(
    LetterPdf({
      therapistName: psychologist?.fullName ?? 'Clinician',
      rciNumber: psychologist?.rciNumber ?? '—',
      recipient: letter.recipient,
      subject: letter.subject,
      body: letter.body,
      generatedAt: letter.createdAt.toISOString(),
    }),
  );

  const dateStr = letter.createdAt.toISOString().slice(0, 10);
  const safeSubject = letter.subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const filename = `letter-${safeSubject}-${dateStr}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
