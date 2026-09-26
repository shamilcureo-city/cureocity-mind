import { createHash } from 'node:crypto';
import { DifferentialDiagnosisV1Schema, MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './sign-note-payload';
import {
  SCRIBE_CODING_MAX_ENTRIES,
  ScribeCodingBodySchema,
  ScribeCodingEntrySchema,
  ScribeCodingRecordSchema,
  ScribeCodingResponseSchema,
  ScribeCodingSaveSchema,
  ScribeCodingWorksheetSchema,
  scribeCodingNoteIdentity,
  scribeCodingSuggestions,
  type ScribeCodingBody,
  type ScribeCodingEntry,
  type ScribeCodingResponse,
  type ScribeCodingWorksheet,
} from './scribe-coding';

const note = () => MedicalEncounterNoteV1Schema.parse({ version: 'V1' });
const hash = 'a'.repeat(64);
const timestamp = '2026-09-26T10:00:00.000Z';
const entry = (overrides: Partial<ScribeCodingEntry> = {}): ScribeCodingEntry => ({
  id: 'entry-1',
  origin: 'manual',
  code: '',
  label: '',
  system: null,
  release: '',
  decision: 'pending',
  documentation: '',
  ...overrides,
});
const included = (overrides: Partial<ScribeCodingEntry> = {}) =>
  entry({
    code: 'A00.0',
    label: 'Fictional example label; not catalogue-validated',
    system: 'ICD10_WHO',
    release: 'Doctor-entered example release',
    decision: 'include',
    documentation: 'Doctor-entered documentation reference',
    ...overrides,
  });
const worksheet = (
  entries: ScribeCodingEntry[] = [],
  status: ScribeCodingWorksheet['status'] = 'draft',
): ScribeCodingWorksheet => ({ version: 'V1', status, entries });
const body = (): ScribeCodingBody => ({
  worksheet: worksheet(),
  draftId: 'draft-1',
  draftHash: hash,
  reviewedNoteHash: null,
  reviewedAt: null,
  reviewedBy: null,
});
const record = () => ({
  id: 'record-1',
  revision: 1,
  body: body(),
  clientId: 'client-1',
  sessionId: 'session-1',
  createdAt: timestamp,
  updatedAt: timestamp,
});
const response = (): ScribeCodingResponse => ({
  draft: { id: 'draft-1', hash, content: note() },
  signed: false,
  signedNoteHash: null,
  record: null,
  sourceCurrent: null,
  suggestions: [],
});

describe('doctor coding entry validation', () => {
  it('allows incomplete manual or AI proposals to stay pending or be excluded', () => {
    for (const decision of ['pending', 'exclude'] as const)
      expect(ScribeCodingEntrySchema.parse(entry({ decision, code: 'not a code' })).decision).toBe(
        decision,
      );
    expect(ScribeCodingEntrySchema.parse(entry({ origin: 'ai_suggestion' })).system).toBeNull();
  });
  it('requires explicit details on every included entry, even in a draft', () => {
    for (const field of ['system', 'release', 'code', 'label', 'documentation'] as const) {
      const result = ScribeCodingWorksheetSchema.safeParse(
        worksheet([included({ [field]: field === 'system' ? null : ' \n ' })]),
      );
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some((issue) => issue.path.join('.') === `entries.0.${field}`),
        ).toBe(true);
    }
  });
  it.each(['A00', 'A00.0', 'S12.345A', 'Z9Z.ABCD'])(
    'only verifies broad syntax, not catalogue existence, for %s',
    (code) => {
      expect(ScribeCodingEntrySchema.safeParse(included({ code })).success).toBe(true);
    },
  );
  it.each(['a00.0', 'A 00', 'A00-0', 'A00.', 'A00.12345', '6A70', 'Ａ00.0', 'A00\nA01', '10'])(
    'rejects malformed included code %s',
    (code) => {
      expect(ScribeCodingEntrySchema.safeParse(included({ code })).success).toBe(false);
    },
  );
  it('preserves explicit WHO versus CM selection without guessing a release', () => {
    const who = ScribeCodingEntrySchema.parse(included());
    const cm = ScribeCodingEntrySchema.parse(included({ system: 'ICD10_CM' }));
    expect(who.system).toBe('ICD10_WHO');
    expect(cm.system).toBe('ICD10_CM');
    expect(who.release).toBe('Doctor-entered example release');
    for (const system of ['ICD10', 'ICD11', 'SNOMED', 'ICD-10-CM'])
      expect(ScribeCodingEntrySchema.safeParse({ ...included(), system }).success).toBe(false);
  });
  it('trims outer whitespace without changing code case or clinical text', () => {
    expect(
      ScribeCodingEntrySchema.parse(
        included({ code: ' A00.0 ', label: ' No fever. ', documentation: ' 5 mg; not 50 mg. ' }),
      ),
    ).toMatchObject({ code: 'A00.0', label: 'No fever.', documentation: '5 mg; not 50 mg.' });
  });
  it('bounds fields and rejects caller-added verification claims', () => {
    for (const [field, limit] of [
      ['code', 24],
      ['label', 500],
      ['release', 120],
      ['documentation', 4_000],
    ] as const)
      expect(
        ScribeCodingEntrySchema.safeParse(entry({ [field]: 'x'.repeat(limit + 1) })).success,
      ).toBe(false);
    expect(ScribeCodingEntrySchema.safeParse({ ...entry(), catalogueVerified: true }).success).toBe(
      false,
    );
    expect(ScribeCodingEntrySchema.safeParse(entry({ id: '../entry' })).success).toBe(false);
  });
});

describe('coding worksheet review', () => {
  it('permits an explicit review with no included codes but rejects pending decisions', () => {
    expect(ScribeCodingWorksheetSchema.safeParse(worksheet([], 'reviewed')).success).toBe(true);
    expect(
      ScribeCodingWorksheetSchema.safeParse(worksheet([entry({ decision: 'exclude' })], 'reviewed'))
        .success,
    ).toBe(true);
    expect(ScribeCodingWorksheetSchema.safeParse(worksheet([entry()], 'reviewed')).success).toBe(
      false,
    );
    expect(ScribeCodingWorksheetSchema.safeParse(worksheet([included()], 'reviewed')).success).toBe(
      true,
    );
  });
  it('rejects duplicate row IDs, including excluded entries', () => {
    expect(
      ScribeCodingWorksheetSchema.safeParse(worksheet([entry(), entry({ decision: 'exclude' })]))
        .success,
    ).toBe(false);
  });
  it('rejects repeated included codes in the same system and release', () => {
    expect(
      ScribeCodingWorksheetSchema.safeParse(
        worksheet([
          included(),
          included({ id: 'entry-2', release: 'DOCTOR-ENTERED EXAMPLE RELEASE' }),
        ]),
      ).success,
    ).toBe(false);
    for (const override of [
      { decision: 'exclude' as const },
      { system: 'ICD10_CM' as const },
      { release: 'Different explicit release' },
    ])
      expect(
        ScribeCodingWorksheetSchema.safeParse(
          worksheet([included(), included({ id: 'entry-2', ...override })]),
        ).success,
      ).toBe(true);
  });
  it('limits worksheets to 30 entries and rejects unknown version/status', () => {
    const entries = Array.from({ length: SCRIBE_CODING_MAX_ENTRIES }, (_, index) =>
      entry({ id: `entry-${index}` }),
    );
    expect(ScribeCodingWorksheetSchema.safeParse(worksheet(entries)).success).toBe(true);
    expect(
      ScribeCodingWorksheetSchema.safeParse(worksheet([...entries, entry({ id: 'extra' })]))
        .success,
    ).toBe(false);
    for (const override of [{ version: 'V2' }, { status: 'verified' }])
      expect(ScribeCodingWorksheetSchema.safeParse({ ...worksheet(), ...override }).success).toBe(
        false,
      );
  });
});

describe('server-owned saved coding metadata and wire payloads', () => {
  it('requires null review metadata on drafts and all fields on reviewed worksheets', () => {
    expect(ScribeCodingBodySchema.safeParse(body()).success).toBe(true);
    const reviewed: ScribeCodingBody = {
      ...body(),
      worksheet: worksheet([included()], 'reviewed'),
      reviewedNoteHash: 'b'.repeat(64),
      reviewedAt: timestamp,
      reviewedBy: 'doctor-1',
    };
    expect(ScribeCodingBodySchema.safeParse(reviewed).success).toBe(true);
    for (const field of ['reviewedNoteHash', 'reviewedAt', 'reviewedBy'] as const) {
      expect(ScribeCodingBodySchema.safeParse({ ...reviewed, [field]: null }).success).toBe(false);
      expect(
        ScribeCodingBodySchema.safeParse({ ...body(), [field]: reviewed[field] }).success,
      ).toBe(false);
    }
  });
  it('accepts only safe revision and hash bindings in saves', () => {
    const save = {
      expectedRevision: 0,
      draftHash: hash,
      workingNote: note(),
      worksheet: worksheet(),
    };
    expect(ScribeCodingSaveSchema.parse(save)).toEqual(save);
    for (const override of [
      { expectedRevision: -1 },
      { expectedRevision: 0.5 },
      { expectedRevision: '1' },
      { draftHash: 'A'.repeat(64) },
      { draftHash: 'a'.repeat(63) },
      { reviewedBy: 'another-doctor' },
      { reviewedAt: timestamp },
      { reviewedNoteHash: hash },
      { draftId: 'different-draft' },
      { workingNote: { version: 'V2' } },
    ])
      expect(ScribeCodingSaveSchema.safeParse({ ...save, ...override }).success).toBe(false);
  });
  it('validates the encrypted record DTO without a server import', () => {
    expect(ScribeCodingRecordSchema.parse(record())).toEqual(record());
    for (const override of [
      { revision: 0 },
      { updatedAt: 'not a timestamp' },
      { createdAt: null },
      { body: { ...body(), reviewedAt: timestamp } },
    ])
      expect(ScribeCodingRecordSchema.safeParse({ ...record(), ...override }).success).toBe(false);
  });
  it('requires coherent signed, source, and AI proposal states', () => {
    expect(ScribeCodingResponseSchema.parse(response())).toEqual(response());
    expect(
      ScribeCodingResponseSchema.safeParse({
        ...response(),
        record: record(),
        sourceCurrent: false,
      }).success,
    ).toBe(true);
    expect(
      ScribeCodingResponseSchema.safeParse({ ...response(), signed: true, signedNoteHash: hash })
        .success,
    ).toBe(true);
    for (const override of [
      { signed: true },
      { signedNoteHash: hash },
      { sourceCurrent: true },
      { suggestions: [entry()] },
      { suggestions: [entry({ origin: 'ai_suggestion', decision: 'exclude' })] },
      { suggestions: [entry({ origin: 'ai_suggestion', system: 'ICD10_WHO' })] },
      { suggestions: [entry({ origin: 'ai_suggestion', release: 'guessed-release' })] },
      { suggestions: [entry({ origin: 'ai_suggestion', documentation: 'AI assertion' })] },
      { suggestions: [entry({ origin: 'ai_suggestion' }), entry({ origin: 'ai_suggestion' })] },
    ])
      expect(ScribeCodingResponseSchema.safeParse({ ...response(), ...override }).success).toBe(
        false,
      );
  });
});

describe('coding note binding', () => {
  it('is canonical and byte-compatible with server hashing, not a generated clinical opinion', () => {
    const first = note();
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as typeof first;
    expect(scribeCodingNoteIdentity(first)).toBe(scribeCodingNoteIdentity(reordered));
    expect(scribeCodingNoteIdentity(first)).toBe(canonicalJson(first));
    expect(createHash('sha256').update(scribeCodingNoteIdentity(first)).digest('hex')).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
  it('changes when note text, provenance, encounter kind, or structured fields change', () => {
    const first = note();
    for (const override of [
      { assessment: 'No fever.' },
      { plan: '5 mg, not 50 mg.' },
      { encounterKind: 'FOLLOW_UP' as const },
      { linkedEvidence: [{ field: 'assessment' as const, quote: 'No fever.' }] },
      { vitals: { spo2Pct: 97 } },
      { physicalExam: { examined: true, findings: '' } },
      { reviewOfSystems: ['No fever.', 'Cough.'] },
    ])
      expect(scribeCodingNoteIdentity({ ...first, ...override })).not.toBe(
        scribeCodingNoteIdentity(first),
      );
  });
});

describe('existing AI coding proposals', () => {
  const differential = () =>
    DifferentialDiagnosisV1Schema.parse({
      version: 'V1',
      candidates: [
        { condition: 'Unconfirmed example', icd10Code: 'A00.0' },
        { condition: 'No supplied code' },
      ],
      codingNudges: [
        {
          kind: 'SUGGESTED_CODE',
          icd10Code: 'B00',
          message: 'An AI assertion, not documentation.',
        },
        {
          kind: 'DOCUMENTATION_GAP',
          icd10Code: 'C00',
          message: 'A question, not a proposed code.',
        },
        { kind: 'SUGGESTED_CODE', message: 'No code supplied.' },
      ],
    });
  it('leaves every proposal pending and never infers the system, release, or documentation', () => {
    const proposals = scribeCodingSuggestions(differential());
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ code: 'A00.0', label: 'Unconfirmed example' });
    expect(proposals[1]).toMatchObject({ code: 'B00', label: '' });
    for (const proposal of proposals) {
      expect(proposal).toMatchObject({
        origin: 'ai_suggestion',
        decision: 'pending',
        system: null,
        release: '',
        documentation: '',
      });
      expect(proposal.sourceSuggestionId).toBe(proposal.id);
    }
    expect(
      ScribeCodingResponseSchema.safeParse({ ...response(), suggestions: proposals }).success,
    ).toBe(true);
    expect(scribeCodingSuggestions(null)).toEqual([]);
  });
  it('keeps proposal identity stable through reordering but changes it when label/code changes', () => {
    const current = differential();
    const original = scribeCodingSuggestions(current)[0];
    expect(
      scribeCodingSuggestions({ ...current, candidates: [...current.candidates].reverse() })[0],
    ).toEqual(original);
    expect(
      scribeCodingSuggestions({
        ...current,
        candidates: [{ ...current.candidates[0], condition: 'Different proposal' }],
      })[0].id,
    ).not.toBe(original.id);
  });
  it('does not mutate differential data, carry AI claims into documentation, or auto-include', () => {
    const current = differential();
    const before = canonicalJson(current);
    scribeCodingSuggestions(current);
    expect(canonicalJson(current)).toBe(before);
    const malformed = {
      ...current,
      candidates: [{ ...current.candidates[0], condition: 'Review this', icd10Code: 'A??' }],
    };
    expect(scribeCodingSuggestions(malformed)[0]).toMatchObject({
      code: 'A??',
      decision: 'pending',
    });
  });
  it('deduplicates identical proposals and bounds rows without truncating clinical values', () => {
    const current = differential();
    const candidates = [
      current.candidates[0],
      current.candidates[0],
      { ...current.candidates[0], condition: 'x'.repeat(501), icd10Code: 'A00' },
      { ...current.candidates[0], condition: 'Oversized code', icd10Code: 'A'.repeat(25) },
    ];
    expect(scribeCodingSuggestions({ ...current, candidates, codingNudges: [] })).toHaveLength(1);
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...current.candidates[0],
      condition: `Unconfirmed proposal ${index}`,
      icd10Code: 'A00',
    }));
    expect(scribeCodingSuggestions({ ...current, candidates: many })).toHaveLength(
      SCRIBE_CODING_MAX_ENTRIES,
    );
  });
});
