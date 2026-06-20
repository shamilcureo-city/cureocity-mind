import { NextResponse, type NextRequest } from 'next/server';
import { RecordReadingInputSchema } from '@cureocity/contracts';
import { formatReading } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNITS: Record<string, string> = {
  BP: 'mmHg',
  HBA1C: '%',
  FBS: 'mg/dL',
  LDL: 'mg/dL',
  WEIGHT: 'kg',
};

/**
 * Sprint DV7 — POST /api/v1/clients/:id/readings
 *
 * Log one chronic-disease reading manually (HbA1c / FBS / LDL, or a BP /
 * weight not captured from a note). BP requires a diastolic. Tenant-
 * checked; audits CLINICAL_READING_RECORDED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const parsed = await parseJson(req, RecordReadingInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  if (input.measure === 'BP' && input.valueSecondary === undefined) {
    return NextResponse.json(
      { error: 'Blood pressure needs both systolic and diastolic values.' },
      { status: 400 },
    );
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  const reading = await prisma.clinicalReading.create({
    data: {
      clientId,
      psychologistId: auth.value.psychologistId,
      measure: input.measure,
      value: input.value,
      ...(input.valueSecondary !== undefined && { valueSecondary: input.valueSecondary }),
      unit: UNITS[input.measure] ?? '',
      takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
      source: 'MANUAL',
    },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLINICAL_READING_RECORDED',
    targetType: 'ClinicalReading',
    targetId: reading.id,
    metadata: {
      clientId,
      measure: input.measure,
      source: 'MANUAL',
      ...auditMetadataFromRequest(req),
    },
  });

  return NextResponse.json(
    {
      id: reading.id,
      measure: input.measure,
      display: formatReading(input.measure, input.value, input.valueSecondary),
    },
    { status: 201 },
  );
}
