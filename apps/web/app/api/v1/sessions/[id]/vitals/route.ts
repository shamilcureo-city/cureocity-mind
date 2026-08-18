import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Batch F — POST /api/v1/sessions/:id/vitals
 *
 * Vitals could only ever reach the record by being SPOKEN: Pass 2 extracts
 * them from the transcript and `persistVitalReadings` writes the rows. But in
 * an Indian OPD the nurse measures BP and weight at triage and writes them on
 * a slip — nobody says "blood pressure one forty over ninety" out loud. Those
 * numbers were simply lost, which also starved the chronic-disease trajectory
 * that the Journey engine plots.
 *
 * This is the manual entry path. Readings are written with source
 * `MANUAL_ENTRY`, kept distinct from the transcript-derived `NOTE_VITALS`
 * rows so the provenance of every number stays legible — and so a re-run of
 * the note pass can't clobber what a human typed. Doctor-only, tenant-checked,
 * POST-only.
 */
const VitalsEntrySchema = z
  .object({
    bpSystolic: z.number().int().min(40).max(300).nullable().optional(),
    bpDiastolic: z.number().int().min(20).max(200).nullable().optional(),
    weightKg: z.number().min(1).max(400).nullable().optional(),
  })
  .refine(
    (v) => (v.bpSystolic == null) === (v.bpDiastolic == null),
    'Blood pressure needs both the systolic and the diastolic value.',
  )
  .refine((v) => v.bpSystolic != null || v.weightKg != null, 'Enter at least one reading.');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCapability(req, 'CHRONIC_CARE');
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const parsed = await parseJson(req, VitalsEntrySchema);
  if (!parsed.ok) return parsed.response;
  const vitals = parsed.value;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      scheduledAt: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.psychologist.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'Vitals entry is for the doctor vertical only.' },
      { status: 409 },
    );
  }

  const takenAt = new Date();
  const rows: {
    clientId: string;
    psychologistId: string;
    sessionId: string;
    measure: 'BP' | 'WEIGHT';
    value: number;
    valueSecondary?: number;
    unit: string;
    takenAt: Date;
    source: string;
  }[] = [];
  if (vitals.bpSystolic != null && vitals.bpDiastolic != null) {
    rows.push({
      clientId: session.clientId,
      psychologistId: session.psychologistId,
      sessionId,
      measure: 'BP',
      value: vitals.bpSystolic,
      valueSecondary: vitals.bpDiastolic,
      unit: 'mmHg',
      takenAt,
      source: 'MANUAL_ENTRY',
    });
  }
  if (vitals.weightKg != null) {
    rows.push({
      clientId: session.clientId,
      psychologistId: session.psychologistId,
      sessionId,
      measure: 'WEIGHT',
      value: vitals.weightKg,
      unit: 'kg',
      takenAt,
      source: 'MANUAL_ENTRY',
    });
  }

  // Re-submitting replaces this session's manual readings (a doctor
  // correcting a typo), and never touches the transcript-derived rows.
  await prisma.$transaction(async (tx) => {
    await tx.clinicalReading.deleteMany({ where: { sessionId, source: 'MANUAL_ENTRY' } });
    if (rows.length > 0) await tx.clinicalReading.createMany({ data: rows });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLINICAL_READING_RECORDED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          clientId: session.clientId,
          source: 'MANUAL_ENTRY',
          count: rows.length,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ recorded: rows.length }, { status: 201 });
}
