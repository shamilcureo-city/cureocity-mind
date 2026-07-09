import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { RxPadV1Schema, type RxPadV1 } from '@cureocity/contracts';
import { RxPadPdf } from '@/components/pdf/RxPadPdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { decryptClientField } from '@/lib/client-pii';
import { ageFromDob, safeFileSlug } from '@/lib/doc-format';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS5-fu — GET /api/v1/sessions/:id/rx/pdf
 *
 * Render the prescription pad as a letterhead PDF. Prefers the SIGNED pad
 * (TherapyNote.rxPad — the attested Rx); before sign-off, falls back to the
 * live-drafted pad's CONFIRMED meds so the doctor can preview (the signature
 * block then reads "unsigned draft"). Doctor-vertical only, tenant-checked.
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
      client: { select: { fullNameEncrypted: true, dateOfBirth: true } },
      noteDraft: { select: { id: true, rxPad: true } },
      therapyNote: { select: { id: true, rxPad: true, signedBy: true, signedAt: true } },
      psychologist: {
        select: {
          fullName: true,
          medicalRegNumber: true,
          specialty: true,
          rciNumber: true,
          vertical: true,
        },
      },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.psychologist.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'Prescriptions are for the doctor vertical only.' },
      { status: 409 },
    );
  }

  // Prefer the signed pad; else the confirmed subset of the drafted pad.
  const signedRx = parsePad(session.therapyNote?.rxPad);
  const rx: RxPadV1 | null =
    signedRx ??
    (() => {
      const drafted = parsePad(session.noteDraft?.rxPad);
      return drafted
        ? { ...drafted, meds: drafted.meds.filter((m) => m.status === 'confirmed') }
        : null;
    })();
  if (!rx) {
    return NextResponse.json(
      { error: 'No prescription recorded for this consult.' },
      { status: 404 },
    );
  }

  const clientFullName = await decryptClientField(
    session.psychologistId,
    session.client.fullNameEncrypted,
  );

  const buffer = await renderToBuffer(
    RxPadPdf({
      rx,
      clientFullName,
      ageYears: ageFromDob(session.client.dateOfBirth),
      sessionId: session.id,
      scheduledAt: session.scheduledAt.toISOString(),
      prescriberName: session.psychologist.fullName,
      medicalRegNumber: session.psychologist.medicalRegNumber,
      rciNumber: session.psychologist.rciNumber,
      specialty: session.psychologist.specialty,
      clinicName: null,
      // Only stamp "Signed by …" when the rendered pad IS the signed pad.
      // On the draft fallback (signedRx null — e.g. a note signed before
      // DS5-fu, so TherapyNote.rxPad was never populated), the signature
      // block must read "unsigned draft", per this route's contract.
      signedBy: signedRx ? (session.therapyNote?.signedBy ?? null) : null,
      signedAt: signedRx ? (session.therapyNote?.signedAt?.toISOString() ?? null) : null,
    }),
  );

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'NOTE_DRAFT_VIEWED',
    targetType: 'NoteDraft',
    targetId: session.noteDraft?.id ?? session.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      sessionId: session.id,
      clientId: session.clientId,
      format: 'pdf',
      doc: 'rx',
      // Provenance of the rendered pad: true only when the SIGNED pad was used.
      signed: signedRx != null,
      bytes: buffer.length,
    },
  });

  const filename = `prescription-${safeFileSlug(clientFullName)}-${session.scheduledAt
    .toISOString()
    .slice(0, 10)}.pdf`;
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

/** Defensive parse — bad stored JSON degrades to null, never a 500. */
function parsePad(value: unknown): RxPadV1 | null {
  if (value == null) return null;
  const parsed = RxPadV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
