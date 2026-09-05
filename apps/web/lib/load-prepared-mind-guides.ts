import {
  TherapyScriptV1Schema,
  type PractitionerCapability,
  type PractitionerVertical,
  type TherapyScriptV1,
} from '@cureocity/contracts';
import { writeAudit } from './audit';
import { prisma } from './prisma';

export interface PreparedMindGuide {
  id: string;
  body: TherapyScriptV1;
  updatedAt: string;
}

/**
 * Previously prepared material for live-session reference, not a fresh
 * recommendation. This loader never invokes an AI model or creates a script.
 * The caller supplies the authenticated practitioner's current capability set.
 */
export async function loadPreparedMindGuides(input: {
  clientId: string;
  psychologistId: string;
  vertical: PractitionerVertical;
  capabilities: ReadonlySet<PractitionerCapability>;
}): Promise<PreparedMindGuide[]> {
  if (input.vertical !== 'THERAPIST' || !input.capabilities.has('THERAPY_WORKFLOWS')) return [];

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== input.psychologistId) {
    return [];
  }

  const owner = { clientId: input.clientId, psychologistId: input.psychologistId };
  const [plan, diagnosis] = await Promise.all([
    prisma.treatmentPlan.findFirst({
      where: { ...owner, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true },
    }),
    prisma.clientDiagnosis.findFirst({
      where: { ...owner, isPrimary: true, supersededAt: null },
      orderBy: { confirmedAt: 'desc' },
      select: { id: true },
    }),
  ]);

  const rows = await prisma.therapyScript.findMany({
    where: {
      ...owner,
      // Null matches only when no current plan/primary diagnosis exists.
      sourceTreatmentPlanId: plan?.id ?? null,
      sourcePrimaryDiagnosisId: diagnosis?.id ?? null,
      // Recheck lifecycle at the content-disclosure query as well.
      client: { psychologistId: input.psychologistId, deletedAt: null },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { id: true, body: true, updatedAt: true },
  });

  const guides: PreparedMindGuide[] = [];
  for (const row of rows) {
    const parsed = TherapyScriptV1Schema.safeParse(row.body);
    if (!parsed.success) continue;
    const guide = { id: row.id, body: parsed.data, updatedAt: row.updatedAt.toISOString() };
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: input.psychologistId,
      action: 'THERAPY_SCRIPT_VIEWED',
      targetType: 'TherapyScript',
      targetId: row.id,
      metadata: {
        clientId: input.clientId,
        therapyName: guide.body.therapyName,
        language: guide.body.language,
        source: 'prepared_live_guide',
      },
    });
    guides.push(guide);
  }
  return guides;
}
