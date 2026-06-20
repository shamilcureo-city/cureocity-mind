import { describe, expect, it } from 'vitest';
import { buildFhirBundle, type FhirExportInput } from './fhir';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';

const NOTE: MedicalEncounterNoteV1 = {
  version: 'V1',
  encounterKind: 'NEW_OPD',
  chiefComplaint: 'Chest pain ×2 days',
  hpi: 'Exertional, relieved by rest.',
  reviewOfSystems: [],
  physicalExam: { examined: false, findings: '' },
  vitals: { bpSystolic: 148, bpDiastolic: 92 },
  assessment: 'Rule out stable angina.',
  plan: 'ECG, aspirin, review in 3 days.',
  linkedEvidence: [],
};

const INPUT: FhirExportInput = {
  note: NOTE,
  medications: [
    {
      version: 'V1',
      drug: 'Aspirin',
      strength: '75 mg',
      dose: '1 tablet',
      frequency: 'once daily',
      durationDays: 30,
      prn: false,
      interactionWarnings: [],
    },
  ],
  clinicalOrders: [
    {
      version: 'V1',
      category: 'PROCEDURE',
      description: '12-lead ECG',
      rationale: 'screen ischaemia',
    },
  ],
  patient: { id: 'c1', displayName: 'A B', abhaAddress: 'ab@sbx' },
  practitioner: { id: 'p1', displayName: 'Dr X', regNumber: 'NMC123' },
  encounterDate: '2026-06-20T10:00:00.000Z',
};

describe('buildFhirBundle', () => {
  const bundle = buildFhirBundle(INPUT);

  it('is a FHIR R4 document Bundle', () => {
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.timestamp).toBe(INPUT.encounterDate);
  });

  it('leads with a Composition referencing patient + practitioner', () => {
    const comp = bundle.entry[0]!.resource;
    expect(comp.resourceType).toBe('Composition');
    expect((comp.subject as { reference: string }).reference).toContain('patient-c1');
    expect((comp.author as { reference: string }[])[0]!.reference).toContain('practitioner-p1');
  });

  it('emits a Composition section per documented note field', () => {
    const comp = bundle.entry[0]!.resource;
    const titles = (comp.section as { title: string }[]).map((s) => s.title);
    expect(titles).toContain('Chief complaint');
    expect(titles).toContain('Plan');
    // PE not examined → no physical-exam section
    expect(titles).not.toContain('Physical examination');
  });

  it('emits one MedicationRequest per drug with dosage text', () => {
    const meds = bundle.entry.filter((e) => e.resource.resourceType === 'MedicationRequest');
    expect(meds).toHaveLength(1);
    const dosage = (meds[0]!.resource.dosageInstruction as { text: string }[])[0]!.text;
    expect(dosage).toContain('once daily');
    expect(dosage).toContain('for 30 days');
  });

  it('emits one ServiceRequest per clinical order', () => {
    const orders = bundle.entry.filter((e) => e.resource.resourceType === 'ServiceRequest');
    expect(orders).toHaveLength(1);
    expect((orders[0]!.resource.code as { text: string }).text).toBe('12-lead ECG');
  });

  it('carries the ABHA identifier on the Patient resource', () => {
    const patient = bundle.entry.find((e) => e.resource.resourceType === 'Patient')!.resource;
    const ids = patient.identifier as { system: string; value: string }[];
    expect(ids[0]!.value).toBe('ab@sbx');
    expect(ids[0]!.system).toContain('ndhm.gov.in');
  });

  it('includes a Physical examination section when an exam was performed', () => {
    const examined = buildFhirBundle({
      ...INPUT,
      note: { ...NOTE, physicalExam: { examined: true, findings: 'S1 S2 normal, no murmur.' } },
    });
    const comp = examined.entry[0]!.resource;
    const titles = (comp.section as { title: string }[]).map((s) => s.title);
    expect(titles).toContain('Physical examination');
  });
});
