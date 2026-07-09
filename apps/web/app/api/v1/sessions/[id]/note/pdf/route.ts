import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import type { IntakeNoteV1, TherapyNoteV1 } from '@cureocity/contracts';
import { IntakeNotePdf } from '@/components/pdf/IntakeNotePdf';
import { SignedNotePdf } from '@/components/pdf/SignedNotePdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sessions/[id]/note/pdf — render the signed therapy note
 * as a PDF and stream it to the therapist. Audits as NOTE_DRAFT_VIEWED
 * with `{ format: 'pdf' }` — viewing in PDF form is the same audit
 * verb as viewing in HTML, the format is just metadata.
 *
 * 404 if the session has no signed therapy note yet — drafts cannot
 * be downloaded as a PDF (they're not the canonical record).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      client: { select: { fullNameEncrypted: true } },
      therapyNote: true,
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const clientFullName = await decryptClientField(
    session.psychologistId,
    session.client.fullNameEncrypted,
  );
  if (!session.therapyNote || !session.therapyNote.content) {
    return NextResponse.json(
      { error: 'Session has no signed therapy note yet — sign before downloading.' },
      { status: 404 },
    );
  }

  const durationMs =
    session.startedAt && session.endedAt
      ? session.endedAt.getTime() - session.startedAt.getTime()
      : null;

  // Sprint 49 — INTAKE sessions store an IntakeNoteV1 here; render the
  // intake-specific PDF. Other kinds still render the SOAP PDF.
  const isIntake = session.kind === 'INTAKE';
  const pdfDocument = isIntake
    ? IntakeNotePdf({
        note: session.therapyNote.content as unknown as IntakeNoteV1,
        clientFullName,
        sessionId: session.id,
        scheduledAt: session.scheduledAt.toISOString(),
        durationMs,
        signedBy: session.therapyNote.signedBy,
        signedAt: session.therapyNote.signedAt?.toISOString() ?? null,
      })
    : SignedNotePdf({
        note: session.therapyNote.content as unknown as TherapyNoteV1,
        clientFullName,
        sessionId: session.id,
        scheduledAt: session.scheduledAt.toISOString(),
        durationMs,
        signedBy: session.therapyNote.signedBy,
        signedAt: session.therapyNote.signedAt?.toISOString() ?? null,
      });
  const buffer = await renderToBuffer(pdfDocument);

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'NOTE_DRAFT_VIEWED',
    targetType: 'TherapyNote',
    targetId: session.therapyNote.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      sessionId: session.id,
      clientId: session.clientId,
      format: 'pdf',
      bytes: buffer.length,
      kind: isIntake ? 'INTAKE' : 'TREATMENT',
    },
  });

  // Filename: {intake|session}-note-{clientName}-{YYYY-MM-DD}.pdf
  const dateStr = session.scheduledAt.toISOString().slice(0, 10);
  const safeName = clientFullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const filename = `${isIntake ? 'intake' : 'session'}-note-${safeName}-${dateStr}.pdf`;

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
