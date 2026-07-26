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

  it('carries the patient active meds as continued, PENDING a confirm tap', () => {
    // Batch B — a repeat prescription is still a prescription. Continued rows
    // used to land `confirmed`, reissuing standing meds nobody looked at.
    const pad = assembleRxPad(input({ patient: patient({ activeMeds: ['Amlodipine 5 mg'] }) }));
    const amlo = pad.meds.find((m) => m.drug.toLowerCase().startsWith('amlodipine'));
    expect(amlo?.continued).toBe(true);
    expect(amlo?.status).toBe('pending');
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

  it('carries the source utteranceId from a spoken med + order onto the pad rows', () => {
    // DS11.5-fu — the gateway stamps the heard utterance on the command; the
    // pad must pass it through so the browser can render a 🗣 quote-chip.
    const voiceCommands: VoiceCommand[] = [
      { kind: 'ADD_MEDICATION', raw: 'add metformin', drug: 'Metformin', utteranceId: 'u7' },
      { kind: 'ORDER_TEST', raw: 'order hba1c', description: 'HbA1c', utteranceId: 'u9' },
    ];
    const pad = assembleRxPad(input({ voiceCommands }));
    expect(pad.meds.find((m) => m.drug === 'Metformin')?.utteranceId).toBe('u7');
    expect(pad.investigations.find((i) => i.name === 'HbA1c')?.utteranceId).toBe('u9');
  });

  it('leaves utteranceId unset on continued + AI-drafted meds', () => {
    const pad = assembleRxPad(
      input({
        patient: patient({ activeMeds: ['Amlodipine 5 mg'] }),
        medications: [med({ drug: 'Aspirin' })],
      }),
    );
    expect(
      pad.meds.find((m) => m.drug.toLowerCase().startsWith('amlodipine'))?.utteranceId,
    ).toBeUndefined();
    expect(pad.meds.find((m) => m.drug === 'Aspirin')?.utteranceId).toBeUndefined();
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

describe('assembleRxPad — Batch B safety', () => {
  it('lets a spoken dose change SUPERSEDE a continued med instead of vanishing', () => {
    // The doctor says "make her metformin one gram". The old assembler saw a
    // duplicate first-word key and dropped the new instruction on the floor,
    // leaving the slip printing the old 500mg.
    const voiceCommands: VoiceCommand[] = [
      {
        kind: 'ADD_MEDICATION',
        raw: 'metformin 1 g BD',
        drug: 'Metformin',
        strength: '1 g',
        frequency: 'BD',
      },
    ];
    const pad = assembleRxPad(
      input({ patient: patient({ activeMeds: ['Metformin 500 mg BD'] }), voiceCommands }),
    );
    const rows = pad.meds.filter((m) => m.drug.toLowerCase().includes('metformin'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.strength).toBe('1 g');
    expect(rows[0]!.status).toBe('pending'); // the change needs a deliberate confirm
    expect(rows[0]!.continued).toBe(true); // still a change to a standing med
    expect(rows[0]!.previous).toBe('Metformin 500 mg BD');
  });

  it('keeps two multi-word generics that share a first word', () => {
    const pad = assembleRxPad(
      input({
        patient: patient({ activeMeds: ['Insulin glargine 10 U HS', 'Insulin aspart 6 U TDS'] }),
      }),
    );
    expect(pad.meds.filter((m) => m.drug.toLowerCase().startsWith('insulin'))).toHaveLength(2);
  });

  it('flags a prescribed drug against the recorded allergy, on the row itself', () => {
    const pad = assembleRxPad(
      input({
        patient: patient({ allergies: ['Penicillin'] }),
        medications: [med({ drug: 'Amoxicillin', strength: '500 mg' })],
      }),
    );
    const amox = pad.meds.find((m) => m.drug === 'Amoxicillin');
    expect(amox?.warnings.some((w) => w.includes('DO NOT PRESCRIBE'))).toBe(true);
  });

  it('stays quiet when the prescription and the allergies do not conflict', () => {
    const pad = assembleRxPad(
      input({
        patient: patient({ allergies: ['Penicillin'] }),
        medications: [med({ drug: 'Azithromycin', strength: '500 mg' })],
      }),
    );
    const azi = pad.meds.find((m) => m.drug === 'Azithromycin');
    expect(azi?.warnings).toEqual([]);
  });
});

describe('assembleRxPad — the doctor outranks the model', () => {
  it('keeps the SPOKEN dose when Pass 2 also drafts the same drug', () => {
    // Rows are pushed continued → spoken → drafted, so a naive "later wins"
    // rule would let the model's inferred dose overwrite what the doctor
    // actually said. It must not.
    const voiceCommands: VoiceCommand[] = [
      {
        kind: 'ADD_MEDICATION',
        raw: 'aspirin 150 od',
        drug: 'Aspirin',
        strength: '150 mg',
        utteranceId: 'u4',
      },
    ];
    const pad = assembleRxPad(
      input({ medications: [med({ drug: 'Aspirin', strength: '75 mg' })], voiceCommands }),
    );
    const rows = pad.meds.filter((m) => m.drug.toLowerCase() === 'aspirin');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.strength).toBe('150 mg'); // the spoken dose, not the drafted one
    expect(rows[0]!.source).toBe('dictated');
    expect(rows[0]!.utteranceId).toBe('u4');
  });

  it('lets an AI-drafted med supersede a plain continued row', () => {
    const pad = assembleRxPad(
      input({
        patient: patient({ activeMeds: ['Amlodipine 5 mg'] }),
        medications: [med({ drug: 'Amlodipine', strength: '10 mg' })],
      }),
    );
    const rows = pad.meds.filter((m) => m.drug.toLowerCase().startsWith('amlodipine'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.strength).toBe('10 mg');
    expect(rows[0]!.previous).toBe('Amlodipine 5 mg');
  });
});
