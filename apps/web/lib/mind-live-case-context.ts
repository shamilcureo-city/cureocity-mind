import {
  CaseFormulationV1Schema,
  ClinicalTreatmentPlanSchema,
  TherapyApprovedCaseContextSchema,
  type PractitionerCapability,
  type TherapyApprovedCaseContext,
} from '@cureocity/contracts';
import { prisma } from './prisma';
import { writeAudit } from './audit';
import { lockActiveClient, ClientPhiWriteForbiddenError } from './phi-write-lock';

/** Minimized background for explicit review, never automatically sent to AI.
 * Release flag keeps the web feature off until the gateway ack protocol ships. */
export async function loadMindLiveCaseContext(input: {
  clientId: string;
  psychologistId: string;
  capabilities: ReadonlySet<PractitionerCapability>;
}): Promise<TherapyApprovedCaseContext | null> {
  if (
    process.env['MIND_LIVE_CASE_CONTEXT'] !== 'true' ||
    !input.capabilities.has('CLINICAL_ANALYSIS')
  )
    return null;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockActiveClient(tx, input.clientId, input.psychologistId);
      const owner = {
        clientId: input.clientId,
        psychologistId: input.psychologistId,
        client: { psychologistId: input.psychologistId, deletedAt: null },
      };
      const [formulation, plan, diagnoses, measures] = await Promise.all([
        tx.caseFormulation.findFirst({
          where: { ...owner, supersededAt: null },
          orderBy: { version: 'desc' },
          select: { version: true, body: true },
        }),
        tx.treatmentPlan.findFirst({
          where: { ...owner, supersededAt: null },
          orderBy: { version: 'desc' },
          select: { body: true },
        }),
        tx.clientDiagnosis.findMany({
          where: { ...owner, supersededAt: null },
          orderBy: { isPrimary: 'desc' },
          take: 6,
          select: { icd11Code: true, icd11Label: true },
        }),
        input.capabilities.has('MEASUREMENT_BASED_CARE')
          ? Promise.all(
              ['PHQ9', 'GAD7'].map((instrumentKey) =>
                tx.instrumentResponse.findFirst({
                  where: { ...owner, instrumentKey },
                  orderBy: { administeredAt: 'desc' },
                  select: { instrumentKey: true, score: true, administeredAt: true },
                }),
              ),
            )
          : Promise.resolve([]),
      ]);
      const f = CaseFormulationV1Schema.safeParse(formulation?.body);
      const p = ClinicalTreatmentPlanSchema.safeParse(plan?.body);
      const context = TherapyApprovedCaseContextSchema.parse({
        version: 'V1',
        preparedAt: new Date().toISOString(),
        formulation:
          f.success && formulation
            ? { version: formulation.version, narrative: f.data.narrative.slice(0, 1800) }
            : null,
        goals: p.success ? p.data.goals.slice(0, 8).map((g) => g.description.slice(0, 400)) : [],
        diagnoses: diagnoses.map((d) => ({
          code: d.icd11Code.slice(0, 40),
          label: d.icd11Label.slice(0, 160),
        })),
        measures: measures.flatMap((m) =>
          m
            ? [
                {
                  instrument: m.instrumentKey,
                  score: m.score,
                  recordedAt: m.administeredAt.toISOString(),
                },
              ]
            : [],
        ),
        guide: null,
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: input.psychologistId,
          action: 'CLIENT_VIEWED',
          targetType: 'Client',
          targetId: input.clientId,
          metadata: { source: 'live_case_context_review', containsClinicalContent: false },
        },
        tx,
      );
      return context;
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return null;
    // Optional background must not prevent the clinical visit. No payload or
    // validation error details enter logs/page errors, and nothing is sent.
    return null;
  }
}
