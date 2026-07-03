import { describe, expect, it } from 'vitest';
import type {
  ClinicalOrderV1,
  MedicalEncounterNoteV1,
  MedicationOrderV1,
  PatientContext,
  VoiceCommand,
} from '@cureocity/contracts';
import { assembleRxPad, type RxPadInput } from './rx-pad';

function patient(over: Partial<PatientContext> = {}): PatientContext {
  return { sex: 'unknown', knownConditions: [], activeMeds: [], allergies: [], ...over };
}

function med(
  over: Partial<MedicationOrderV1> & Pick<MedicationOrderV1, 'drug'>,
): MedicationOrderV1 {
  return { version: 'V1', prn: false, interactionWarnings: [], ...over };
}

const NOTE: MedicalEncounterNoteV1 = {
  version: 'V1',
  encounterKind: 'NEW_OPD',
  chiefComplaint: 'Exertional chest pressure ×2 days',
  hpi: 'Retrosternal pressure on exertion.',
  reviewOfSystems: [],
  physicalExam: { examined: false, findings: '' },
  vitals: { bpSystolic: 148, bpDiastolic: 92, heartRateBpm: 88 },
  assessment: 'Exertional chest pain — rule out stable angina / ACS.',
  plan: 'ECG today; aspirin if no contraindication; advise rest; review in 3 days with reports.',
  linkedEvidence: [],
};

function input(over: Partial<RxPadInput> = {}): RxPadInput {
  return {
    patient: patient(),
    note: NOTE,
    medications: [],
    orders: [],
    voiceCommands: [],
    ...over,
  };
}

describe('assembleRxPad', () => {
  it('derives the dx line + vitals line from the note', () => {
    const pad = assembleRxPad(input());
    expect(pad.dxLine).toContain('stable angina');
    expect(pad.vitalsLine).toBe('BP 148/92 · HR 88');
  });

  it('carries the patient active meds as continued + confirmed', () => {
    const pad = assembleRxPad(input({ patient: patient({ activeMeds: ['Amlodipine 5 mg'] }) }));
    const amlo = pad.meds.find((m) => m.drug.toLowerCase().startsWith('amlodipine'));
    expect(amlo?.continued).toBe(true);
    expect(amlo?.status).toBe('confirmed');
  });

  it('lands drafted note meds as pending (confirm-first) with warnings', () => {
    const pad = assembleRxPad(
      input({
        medications: [med({ drug: 'Aspirin', strength: '75 mg', interactionWarnings: ['x'] })],
      }),
    );
    const asp = pad.meds.find((m) => m.drug === 'Aspirin');
    expect(asp?.status).toBe('pending');
    expect(asp?.continued).toBe(false);
    expect(asp?.warnings).toEqual(['x']);
  });

  it('lands spoken meds as pending and dedups against drafted meds', () => {
    const voiceCommands: VoiceCommand[] = [
      { kind: 'ADD_MEDICATION', raw: 'add aspirin', drug: 'Aspirin', frequency: '0-0-1' },
    ];
    const pad = assembleRxPad(input({ medications: [med({ drug: 'Aspirin' })], voiceCommands }));
    expect(pad.meds.filter((m) => m.drug.toLowerCase() === 'aspirin')).toHaveLength(1);
  });

  it('maps clinical orders to investigations + referrals to advice', () => {
    const orders: ClinicalOrderV1[] = [
      { version: 'V1', category: 'PROCEDURE', description: '12-lead ECG', rationale: 'ischaemia' },
      { version: 'V1', category: 'REFERRAL', description: 'Cardiology OPD' },
    ];
    const pad = assembleRxPad(input({ orders }));
    expect(pad.investigations.some((i) => i.name === '12-lead ECG')).toBe(true);
    expect(pad.adviceLines.some((a) => a.startsWith('Refer: Cardiology OPD'))).toBe(true);
  });

  it('adds spoken order tests to investigations', () => {
    const voiceCommands: VoiceCommand[] = [
      { kind: 'ORDER_TEST', raw: 'order troponin', description: 'Troponin' },
    ];
    const pad = assembleRxPad(input({ voiceCommands }));
    expect(pad.investigations.some((i) => i.name === 'Troponin')).toBe(true);
  });

  it('parses a follow-up from the plan + advice excludes med/order lines', () => {
    const pad = assembleRxPad(input({ medications: [med({ drug: 'Aspirin' })] }));
    expect(pad.followUp?.when).toContain('3 days');
    // "advise rest" survives as advice; the aspirin + review lines don't.
    expect(pad.adviceLines.some((a) => /rest/i.test(a))).toBe(true);
    expect(pad.adviceLines.some((a) => /review/i.test(a))).toBe(false);
    expect(pad.adviceLines.some((a) => /aspirin/i.test(a))).toBe(false);
  });

  it('surfaces the patient allergies', () => {
    const pad = assembleRxPad(input({ patient: patient({ allergies: ['penicillin'] }) }));
    expect(pad.allergies).toEqual(['penicillin']);
  });
});
