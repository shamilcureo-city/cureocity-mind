import type {
  ClinicalOrderV1,
  MedicalEncounterNoteV1,
  MedicationOrderV1,
} from '@cureocity/contracts';

/**
 * Sprint DV8.1 — FHIR R4 export.
 *
 * Maps our internal DTOs (the signed encounter note + confirmed Rx +
 * clinical orders) to a FHIR R4 *document* Bundle — the interoperability
 * artifact ABDM (India's health-data network) consumes. Deterministic, no
 * LLM. Intentionally a focused subset (Composition + Patient +
 * Practitioner + MedicationRequest + ServiceRequest) rather than the full
 * FHIR surface; extend as the ABDM HIP profile requires. See
 * docs/DOCTOR_VERTICAL.md §11, docs/DOCTOR_VERTICAL_SPRINTS.md DV8.
 *
 * FHIR resources are plain JSON; we type them loosely (Record) rather
 * than vendoring the enormous FHIR schema — the shape is asserted by
 * tests, and downstream the ABDM gateway validates against its profile.
 */

export interface FhirResourceEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'document';
  timestamp: string;
  entry: FhirResourceEntry[];
}

export interface FhirExportInput {
  note: MedicalEncounterNoteV1;
  medications: MedicationOrderV1[];
  clinicalOrders: ClinicalOrderV1[];
  patient: { id: string; displayName?: string; abhaAddress?: string };
  practitioner: { id: string; displayName?: string; regNumber?: string };
  /** ISO timestamp of the encounter. */
  encounterDate: string;
}

const ORDER_CATEGORY_LOINC: Record<ClinicalOrderV1['category'], string> = {
  LAB: 'Laboratory procedure',
  IMAGING: 'Imaging',
  REFERRAL: 'Referral',
  PROCEDURE: 'Procedure',
};

/** Build a FHIR R4 document Bundle from one encounter's signed artifacts. */
export function buildFhirBundle(input: FhirExportInput): FhirBundle {
  const patientUrn = `urn:uuid:patient-${input.patient.id}`;
  const practitionerUrn = `urn:uuid:practitioner-${input.practitioner.id}`;

  const medEntries = input.medications.map((m, i) => {
    const urn = `urn:uuid:medreq-${i}`;
    return {
      fullUrl: urn,
      resource: {
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        subject: { reference: patientUrn },
        requester: { reference: practitionerUrn },
        medicationCodeableConcept: {
          text: [m.drug, m.strength].filter(Boolean).join(' '),
        },
        dosageInstruction: [
          {
            text: [
              m.dose,
              m.frequency,
              m.route,
              m.durationDays ? `for ${m.durationDays} days` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            ...(m.instructions ? { patientInstruction: m.instructions } : {}),
          },
        ],
        ...(m.durationDays
          ? { dispenseRequest: { expectedSupplyDuration: { value: m.durationDays, unit: 'd' } } }
          : {}),
      } as Record<string, unknown>,
    };
  });

  const orderEntries = input.clinicalOrders.map((o, i) => {
    const urn = `urn:uuid:servicereq-${i}`;
    return {
      fullUrl: urn,
      resource: {
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        subject: { reference: patientUrn },
        requester: { reference: practitionerUrn },
        category: [{ text: ORDER_CATEGORY_LOINC[o.category] }],
        code: { text: o.description },
        ...(o.rationale ? { note: [{ text: o.rationale }] } : {}),
      } as Record<string, unknown>,
    };
  });

  const composition: FhirResourceEntry = {
    fullUrl: 'urn:uuid:composition-0',
    resource: {
      resourceType: 'Composition',
      status: 'final',
      type: { text: 'OPD encounter note' },
      date: input.encounterDate,
      title: 'OPD Encounter Note',
      subject: { reference: patientUrn },
      author: [{ reference: practitionerUrn }],
      section: [
        section('Chief complaint', input.note.chiefComplaint),
        section('History of present illness', input.note.hpi),
        section('Assessment', input.note.assessment),
        section('Plan', input.note.plan),
        ...(input.note.physicalExam?.examined
          ? [section('Physical examination', input.note.physicalExam.findings)]
          : []),
      ].filter((s): s is Record<string, unknown> => s !== null),
    },
  };

  const patient: FhirResourceEntry = {
    fullUrl: patientUrn,
    resource: {
      resourceType: 'Patient',
      ...(input.patient.displayName ? { name: [{ text: input.patient.displayName }] } : {}),
      ...(input.patient.abhaAddress
        ? {
            identifier: [
              { system: 'https://healthid.ndhm.gov.in', value: input.patient.abhaAddress },
            ],
          }
        : {}),
    },
  };

  const practitioner: FhirResourceEntry = {
    fullUrl: practitionerUrn,
    resource: {
      resourceType: 'Practitioner',
      ...(input.practitioner.displayName
        ? { name: [{ text: input.practitioner.displayName }] }
        : {}),
      ...(input.practitioner.regNumber
        ? {
            identifier: [
              { system: 'https://nmc.org.in/registration', value: input.practitioner.regNumber },
            ],
          }
        : {}),
    },
  };

  return {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: input.encounterDate,
    entry: [composition, patient, practitioner, ...medEntries, ...orderEntries],
  };
}

function section(title: string, text: string | undefined): Record<string, unknown> | null {
  if (!text || text.trim().length === 0) return null;
  return {
    title,
    text: {
      status: 'generated',
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(text)}</div>`,
    },
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
