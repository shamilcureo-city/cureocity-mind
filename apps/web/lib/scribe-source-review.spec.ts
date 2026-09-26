import { MedicalEncounterNoteV1Schema, MedicalEvidenceFieldSchema } from '@cureocity/contracts';
import { describe, expect, it } from 'vitest';
import {
  SOURCE_REVIEW_FIELDS,
  parseScribeSourceSnapshot,
  resolveSourceEvidence,
  sourceFieldText,
  sourceNoteIdentity,
  type ScribeSourceSnapshot,
} from './scribe-source-review';

const note = () => MedicalEncounterNoteV1Schema.parse({ version: 'V1' });
const snapshot = (): ScribeSourceSnapshot => ({
  draftId: 'draft-1',
  version: 'source-revision-1',
  draftContent: note(),
  transcript: 'Patient: No fever.',
  sourceState: 'available',
  sourceMessage: null,
});

describe('source snapshot validation', () => {
  it('accepts only coherent source states and canonicalizes empty sources', () => {
    expect(parseScribeSourceSnapshot(snapshot())).toEqual(snapshot());
    for (const sourceState of ['unavailable', 'quarantined'] as const)
      expect(
        parseScribeSourceSnapshot({ ...snapshot(), sourceState, transcript: null }),
      ).toMatchObject({ sourceState, transcript: null });
    for (const transcript of [null, ''])
      expect(
        parseScribeSourceSnapshot({ ...snapshot(), sourceState: 'empty', transcript }),
      ).toMatchObject({ sourceState: 'empty', transcript: '' });
  });
  it.each([
    null,
    [],
    {},
    { ...snapshot(), draftId: '' },
    { ...snapshot(), version: ' ' },
    { ...snapshot(), draftId: 1 },
    { ...snapshot(), sourceMessage: 5 },
    { ...snapshot(), sourceMessage: undefined },
    { ...snapshot(), sourceState: 'invented' },
    { ...snapshot(), transcript: null },
    { ...snapshot(), transcript: '' },
    { ...snapshot(), transcript: ' \t\n' },
    { ...snapshot(), sourceState: 'unavailable' },
    { ...snapshot(), sourceState: 'quarantined' },
    { ...snapshot(), sourceState: 'empty', transcript: ' ' },
    { ...snapshot(), draftContent: { version: 'V2' } },
    { ...snapshot(), draftContent: { ...note(), vitals: { spo2Pct: 101 } } },
  ])('rejects malformed or contradictory payload %#', (value) => {
    expect(parseScribeSourceSnapshot(value)).toBeNull();
  });
  it('does not truncate valid clinical content during payload validation', () => {
    const transcript = 'word '.repeat(210_000);
    expect(parseScribeSourceSnapshot({ ...snapshot(), transcript })?.transcript).toBe(transcript);
  });
});

describe('saved medical note comparison values', () => {
  it('covers every medical evidence field exactly once', () => {
    expect(SOURCE_REVIEW_FIELDS.map(({ field }) => field)).toEqual(
      MedicalEvidenceFieldSchema.options,
    );
    expect(SOURCE_REVIEW_FIELDS.every(({ label }) => label.length > 0)).toBe(true);
  });
  it('retains narrative values and each review-of-systems entry', () => {
    const current = {
      ...note(),
      chiefComplaint: 'No fever.',
      hpi: 'Two days.',
      assessment: 'Review needed.',
      plan: 'Return tomorrow.',
      reviewOfSystems: ['No fever.', 'Cough.'],
    };
    for (const field of ['chiefComplaint', 'hpi', 'assessment', 'plan'] as const)
      expect(sourceFieldText(current, field)).toBe(current[field]);
    expect(sourceFieldText(current, 'reviewOfSystems')).toBe('No fever.\nCough.');
  });
  it('does not conceal findings that contradict an unexamined flag', () => {
    expect(sourceFieldText(note(), 'physicalExam')).toBe('Not examined');
    expect(
      sourceFieldText(
        { ...note(), physicalExam: { examined: false, findings: 'Chest clear.' } },
        'physicalExam',
      ),
    ).toBe('Not examined\nChest clear.');
    expect(
      sourceFieldText(
        { ...note(), physicalExam: { examined: true, findings: '' } },
        'physicalExam',
      ),
    ).toBe('Examined');
  });
  it('includes all vitals, partial blood pressure, decimals and zero values without inferring missing values', () => {
    const current = {
      ...note(),
      vitals: {
        bpSystolic: 120,
        bpDiastolic: 80,
        heartRateBpm: 72,
        respRateBpm: 16,
        tempCelsius: 0,
        spo2Pct: 0,
        weightKg: 62.5,
      },
    };
    expect(sourceFieldText(current, 'vitals')).toBe(
      'BP systolic: 120 mmHg\nBP diastolic: 80 mmHg\nHeart rate: 72 bpm\nRespiratory rate: 16 breaths/min\nTemperature: 0 °C\nSpO₂: 0 %\nWeight: 62.5 kg',
    );
    expect(sourceFieldText({ ...note(), vitals: { bpDiastolic: 80 } }, 'vitals')).toBe(
      'BP diastolic: 80 mmHg',
    );
    expect(sourceFieldText(note(), 'vitals')).toBe('');
  });
  it('uses canonical complete content regardless of object-key insertion order', () => {
    const current = {
      ...note(),
      vitals: { bpSystolic: 120, bpDiastolic: 80 },
      linkedEvidence: [{ segmentId: 'u1', quote: 'No fever.' }],
    };
    const reordered = {
      linkedEvidence: [{ quote: 'No fever.', segmentId: 'u1' }],
      ...Object.fromEntries(Object.entries(current).reverse()),
      vitals: { bpDiastolic: 80, bpSystolic: 120 },
    } as typeof current;
    reordered.linkedEvidence = [{ quote: 'No fever.', segmentId: 'u1' }];
    expect(sourceNoteIdentity(reordered)).toBe(sourceNoteIdentity(current));
    expect(JSON.parse(sourceNoteIdentity(current))).toEqual(current);
  });
  it('invalidates identity for encounter kind, every clinical field and evidence-only changes', () => {
    const current = {
      ...note(),
      linkedEvidence: [
        {
          segmentId: 'u1',
          quote: 'No fever.',
          startMs: 0,
          endMs: 100,
          claim: 'Afebrile',
          field: 'hpi' as const,
        },
      ],
    };
    const changes = [
      { encounterKind: 'TELECONSULT' as const },
      { chiefComplaint: 'Fever' },
      { hpi: 'Changed' },
      { reviewOfSystems: ['Changed'] },
      { physicalExam: { examined: true, findings: '' } },
      { vitals: { weightKg: 70 } },
      { assessment: 'Changed' },
      { plan: 'Changed' },
      ...Object.entries({
        segmentId: 'u2',
        quote: 'Fever.',
        startMs: 1,
        endMs: 101,
        claim: 'Changed',
        field: 'assessment',
      }).map(([key, value]) => ({
        linkedEvidence: [{ ...current.linkedEvidence[0], [key]: value }],
      })),
    ];
    for (const change of changes)
      expect(sourceNoteIdentity({ ...current, ...change })).not.toBe(sourceNoteIdentity(current));
  });
});

describe('conservative quoted-text location', () => {
  it('returns exact original offsets for repeated, overlapping and Unicode text', () => {
    const transcript = '🙂 No fever. No fever. aaa';
    const result = resolveSourceEvidence({ quote: 'No fever.' }, transcript);
    expect(result).toEqual({
      status: 'located',
      matches: [
        { start: 3, end: 12 },
        { start: 13, end: 22 },
      ],
    });
    expect(result.matches.map(({ start, end }) => transcript.slice(start, end))).toEqual([
      'No fever.',
      'No fever.',
    ]);
    expect(resolveSourceEvidence({ quote: 'aa' }, 'aaa').matches).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
    ]);
    expect(resolveSourceEvidence({ quote: '🙂' }, transcript).matches).toEqual([
      { start: 0, end: 2 },
    ]);
  });
  it('folds whitespace only while correctly mapping the entire original span', () => {
    const transcript = '🙂\tDoctor: No\r\n\t fever.\nPatient: No\u00a0fever.';
    const result = resolveSourceEvidence({ quote: '  No \n fever.  ' }, transcript);
    expect(result.status).toBe('located');
    expect(result.matches.map(({ start, end }) => transcript.slice(start, end))).toEqual([
      'No\r\n\t fever.',
      'No\u00a0fever.',
    ]);
  });
  it.each([
    ['No fever.', 'no fever.'],
    ['No fever.', 'Has fever.'],
    ['No fever.', 'No fever!'],
    ['Dose 10 mg.', 'Dose 1.0 mg.'],
    ['Dose 10 mg.', 'Dose 100 mg.'],
    ['Dose 10 mg.', 'Dose １０ mg.'],
    ['café', 'cafe\u0301'],
    ['No fever.', 'No\u200b fever.'],
  ])('does not infer equivalence between %s and %s', (transcript, quote) => {
    expect(resolveSourceEvidence({ quote }, transcript)).toEqual({
      status: 'not_found',
      matches: [],
    });
  });
  it('does not infer matches from segment IDs, timestamps or a claimed statement', () => {
    expect(
      resolveSourceEvidence(
        { segmentId: 'No fever.', startMs: 0, endMs: 9, claim: 'No fever.' },
        'No fever.',
      ),
    ).toEqual({ status: 'no_quote', matches: [] });
    expect(
      resolveSourceEvidence({ quote: 'No fever.', claim: 'Has fever.' }, 'No fever.').status,
    ).toBe('located');
  });
  it.each([undefined, '', ' \t\n'])('never verifies an empty quote: %s', (quote) => {
    expect(resolveSourceEvidence({ quote }, 'Patient: No fever.')).toEqual({
      status: 'no_quote',
      matches: [],
    });
  });
  it.each([null, '', ' \t\n'])('distinguishes unavailable source: %s', (transcript) => {
    expect(resolveSourceEvidence({ quote: 'No fever.' }, transcript)).toEqual({
      status: 'source_unavailable',
      matches: [],
    });
  });
  it('caps repeated results at 50 and marks only an actual additional match as truncated', () => {
    const fifty = resolveSourceEvidence({ quote: 'x' }, 'x'.repeat(50));
    expect(fifty.matches).toHaveLength(50);
    expect(fifty.truncated).toBeUndefined();
    const repeated = resolveSourceEvidence({ quote: 'x' }, 'x'.repeat(100_000));
    expect(repeated.matches).toHaveLength(50);
    expect(repeated.truncated).toBe(true);
    expect(repeated.matches[49]).toEqual({ start: 49, end: 50 });
  });
  it('fails visibly rather than pretending an oversized source or quote was fully searched', () => {
    expect(resolveSourceEvidence({ quote: 'x' }, 'x'.repeat(1_000_001))).toEqual({
      status: 'source_unavailable',
      matches: [],
      truncated: true,
    });
    expect(resolveSourceEvidence({ quote: 'x'.repeat(16_385) }, 'x')).toEqual({
      status: 'source_unavailable',
      matches: [],
      truncated: true,
    });
  });
  it('handles worst-case repetitive search without dropping a late exact quote', () => {
    const transcript = `${'a'.repeat(150_000)}b`;
    const quote = `${'a'.repeat(10_000)}b`;
    expect(resolveSourceEvidence({ quote }, transcript)).toEqual({
      status: 'located',
      matches: [{ start: 140_000, end: 150_001 }],
    });
  });
});
