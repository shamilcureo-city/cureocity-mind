import {
  ClinicalOrderV1Schema,
  MedicalEncounterNoteV1Schema,
  MedicationOrderV1Schema,
  type ClinicalOrderV1,
  type MedicationOrderV1,
} from '@cureocity/contracts';
import { buildFhirBundle, type FhirBundle } from '@cureocity/clinical';
import { prisma } from './prisma';
import { decryptClientField } from './client-pii';

/**
 * Sprint DV8 — assemble the FHIR R4 export for a signed doctor encounter
 * (the shared spine for both the FHIR-download route and the ABDM PHR
 * push). Requires a SIGNED medical encounter note; includes only
 * CONFIRMED Rx + orders (drafts the doctor never confirmed never leave).
 */
export class FhirExportError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_SIGNED' | 'NOT_MEDICAL',
  ) {
    super(message);
    this.name = 'FhirExportError';
  }
}

export interface EncounterFhir {
  bundle: FhirBundle;
  clientId: string;
  patientName: string;
  abhaAddress: string | null;
}

export async function buildEncounterFhir(
  sessionId: string,
  psychologistId: string,
): Promise<EncounterFhir | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      scheduledAt: true,
      client: { select: { fullNameEncrypted: true, abhaAddress: true } },
      psychologist: { select: { fullName: true, medicalRegNumber: true } },
      therapyNote: { select: { content: true } },
    },
  });
  if (!session || session.psychologistId !== psychologistId) return null;
  const clientFullName = await decryptClientField(psychologistId, session.client.fullNameEncrypted);
  if (!session.therapyNote) {
    throw new FhirExportError(
      'Sign the encounter note before exporting to FHIR / ABDM.',
      'NOT_SIGNED',
    );
  }
  const note = MedicalEncounterNoteV1Schema.safeParse(session.therapyNote.content);
  if (!note.success) {
    throw new FhirExportError(
      'This is not a medical encounter note — export is doctor-only.',
      'NOT_MEDICAL',
    );
  }

  const [medRows, orderRows] = await Promise.all([
    prisma.medicationOrder.findMany({
      where: { sessionId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.clinicalOrder.findMany({
      where: { sessionId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const medications = medRows
    .map((r) => MedicationOrderV1Schema.safeParse(r.content))
    .filter((p): p is { success: true; data: MedicationOrderV1 } => p.success)
    .map((p) => p.data);
  const clinicalOrders = orderRows
    .map((r) => ClinicalOrderV1Schema.safeParse(r.content))
    .filter((p): p is { success: true; data: ClinicalOrderV1 } => p.success)
    .map((p) => p.data);

  const bundle = buildFhirBundle({
    note: note.data,
    medications,
    clinicalOrders,
    patient: {
      id: session.clientId,
      displayName: clientFullName,
      ...(session.client.abhaAddress ? { abhaAddress: session.client.abhaAddress } : {}),
    },
    practitioner: {
      id: session.psychologistId,
      displayName: session.psychologist.fullName,
      ...(session.psychologist.medicalRegNumber
        ? { regNumber: session.psychologist.medicalRegNumber }
        : {}),
    },
    encounterDate: session.scheduledAt.toISOString(),
  });

  return {
    bundle,
    clientId: session.clientId,
    patientName: clientFullName,
    abhaAddress: session.client.abhaAddress,
  };
}
