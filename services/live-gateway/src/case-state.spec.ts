import { describe, expect, it } from 'vitest';
import type { ClinicalFinding, LiveDifferentialItem } from '@cureocity/contracts';
import { CaseStateStore } from './case-state';

function dx(
  over: Partial<LiveDifferentialItem> & Pick<LiveDifferentialItem, 'id'>,
): LiveDifferentialItem {
  return {
    label: 'a condition',
    likelihood: 'moderate',
    trend: 'new',
    urgent: false,
    evidenceFor: ['f1'],
    evidenceAgainst: [],
    ...over,
  };
}

/** Seed a store with utterance u1 + one cited finding f1 (and optionally f2). */
function seededStore(findingIds: string[] = ['f1']): CaseStateStore {
  const store = new CaseStateStore();
  store.registerUtterance('u1');
  store.applyFindings(
    findingIds.map((id) => ({
      id,
      kind: 'symptom' as const,
      label: id,
      utteranceIds: ['u1'],
      polarity: 'present' as const,
    })),
  );
  return store;
}

function finding(over: Partial<ClinicalFinding> & Pick<ClinicalFinding, 'id'>): ClinicalFinding {
  return {
    kind: 'symptom',
    label: 'a finding',
    utteranceIds: ['u1'],
    polarity: 'present',
    ...over,
  };
}

describe('CaseStateStore', () => {
  it('seeds a default patient and empty findings', () => {
    const store = new CaseStateStore();
    expect(store.snapshot.patient.sex).toBe('unknown');
    expect(store.findings).toEqual([]);
    expect(store.version).toBe(0);
  });

  it('seeds the provided patient context', () => {
    const store = new CaseStateStore({
      age: 54,
      sex: 'male',
      knownConditions: ['HTN'],
      activeMeds: ['amlodipine'],
      allergies: [],
    });
    expect(store.snapshot.patient.age).toBe(54);
    expect(store.snapshot.patient.knownConditions).toEqual(['HTN']);
  });

  it('appends new findings and bumps the version', () => {
    const store = new CaseStateStore();
    store.registerUtterance('u1');
    const res = store.applyFindings([finding({ id: 'f1', label: 'chest pain' })]);
    expect(res.accepted).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
    expect(res.changed).toBe(true);
    expect(store.findings.map((f) => f.id)).toEqual(['f1']);
    expect(store.version).toBe(1);
  });

  it('replaces a same-id finding in place (polarity flip, no dupe)', () => {
    const store = new CaseStateStore();
    store.registerUtterance('u1');
    store.registerUtterance('u2');
    store.applyFindings([finding({ id: 'f1', label: 'chest pain', polarity: 'present' })]);
    store.applyFindings([
      finding({ id: 'f1', label: 'chest pain', polarity: 'denied', utteranceIds: ['u2'] }),
    ]);
    expect(store.findings).toHaveLength(1);
    expect(store.findings[0]!.polarity).toBe('denied');
    expect(store.version).toBe(2);
  });

  it('preserves order: replaced items stay put, new items append', () => {
    const store = new CaseStateStore();
    ['u1', 'u2', 'u3'].forEach((id) => store.registerUtterance(id));
    store.applyFindings([
      finding({ id: 'f1', utteranceIds: ['u1'] }),
      finding({ id: 'f2', utteranceIds: ['u2'] }),
    ]);
    store.applyFindings([
      finding({ id: 'f1', label: 'updated', utteranceIds: ['u1'] }),
      finding({ id: 'f3', utteranceIds: ['u3'] }),
    ]);
    expect(store.findings.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(store.findings[0]!.label).toBe('updated');
  });

  it('DROPS findings citing an utterance id that was never produced (poisoned mock)', () => {
    const store = new CaseStateStore();
    store.registerUtterance('u1');
    const res = store.applyFindings([
      finding({ id: 'f1', label: 'real', utteranceIds: ['u1'] }),
      finding({ id: 'f2', label: 'fabricated', utteranceIds: ['u999'] }),
      finding({ id: 'f3', label: 'partly fabricated', utteranceIds: ['u1', 'u999'] }),
    ]);
    expect(res.accepted.map((f) => f.id)).toEqual(['f1']);
    expect(res.dropped.map((f) => f.id)).toEqual(['f2', 'f3']);
    // Only the cited finding reaches the state — the fabrications never render.
    expect(store.findings.map((f) => f.id)).toEqual(['f1']);
  });

  it('drops findings that cite nothing at all', () => {
    const store = new CaseStateStore();
    store.registerUtterance('u1');
    const res = store.applyFindings([finding({ id: 'f1', utteranceIds: [] })]);
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped).toHaveLength(1);
    expect(store.findings).toHaveLength(0);
    expect(store.version).toBe(0); // nothing changed
  });

  it('unions answeredQuestionIds and bumps version even with no new findings', () => {
    const store = new CaseStateStore();
    store.registerUtterance('u1');
    const res = store.applyFindings([], ['q1']);
    expect(res.changed).toBe(true);
    expect(store.snapshot.answeredQuestionIds).toEqual(['q1']);
    expect(store.version).toBe(1);
    // Re-applying the same answered id is a no-op (no version bump).
    const res2 = store.applyFindings([], ['q1']);
    expect(res2.changed).toBe(false);
    expect(store.version).toBe(1);
  });

  it('does not bump version when nothing survives and nothing is answered', () => {
    const store = new CaseStateStore();
    const res = store.applyFindings([finding({ id: 'f1', utteranceIds: ['ghost'] })]);
    expect(res.changed).toBe(false);
    expect(store.version).toBe(0);
  });
});

describe('CaseStateStore.applyReasoning (DS2 differential citation gate)', () => {
  it('keeps candidates that cite a real finding + bumps the reasoning version on commit', () => {
    const store = seededStore(['f1', 'f2']);
    store.applyReasoning([
      dx({ id: 'd1', likelihood: 'high', evidenceFor: ['f1'] }),
      dx({ id: 'd2', likelihood: 'low', evidenceFor: ['f2'] }),
    ]);
    const committed = store.commitReasoning();
    expect(committed.changed).toBe(true);
    expect(committed.version).toBe(1);
    expect(store.differential.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(store.reasoning.version).toBe(1);
  });

  it('DROPS a candidate whose evidence cites no real finding', () => {
    const store = seededStore(['f1']);
    const res = store.applyReasoning([
      dx({ id: 'd1', evidenceFor: ['f1'] }),
      dx({ id: 'd2', evidenceFor: ['f999'] }), // fabricated citation
      dx({ id: 'd3', evidenceFor: [] }), // uncited
    ]);
    expect(res.differential.map((d) => d.id)).toEqual(['d1']);
    expect(res.dropped.map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('filters fabricated ids out of evidence but keeps the candidate if ≥1 real', () => {
    const store = seededStore(['f1']);
    store.applyReasoning([
      dx({ id: 'd1', evidenceFor: ['f1', 'f999'], evidenceAgainst: ['f999'] }),
    ]);
    expect(store.differential[0]!.evidenceFor).toEqual(['f1']);
    expect(store.differential[0]!.evidenceAgainst).toEqual([]);
  });

  it('caps the differential at 5', () => {
    const store = seededStore(['f1']);
    store.applyReasoning(
      Array.from({ length: 8 }, (_, i) => dx({ id: `d${i + 1}`, evidenceFor: ['f1'] })),
    );
    expect(store.differential).toHaveLength(5);
  });

  it('keeps at most 3 open ask-next questions + drops closed ones', () => {
    const store = seededStore(['f1']);
    store.applyReasoning(
      [dx({ id: 'd1', evidenceFor: ['f1'] })],
      [
        {
          id: 'q1',
          question: 'a?',
          why: 'w',
          targetDxIds: ['d1'],
          source: 'DIFFERENTIAL',
          priority: 'high',
          status: 'open',
        },
        {
          id: 'q2',
          question: 'b?',
          why: 'w',
          targetDxIds: ['d1'],
          source: 'DIFFERENTIAL',
          priority: 'normal',
          status: 'open',
        },
        {
          id: 'q3',
          question: 'c?',
          why: 'w',
          targetDxIds: ['d1'],
          source: 'DIFFERENTIAL',
          priority: 'normal',
          status: 'open',
        },
        {
          id: 'q4',
          question: 'd?',
          why: 'w',
          targetDxIds: ['d1'],
          source: 'DIFFERENTIAL',
          priority: 'normal',
          status: 'open',
        },
        {
          id: 'q5',
          question: 'e?',
          why: 'w',
          targetDxIds: ['d1'],
          source: 'DIFFERENTIAL',
          priority: 'normal',
          status: 'answered',
        },
      ],
    );
    expect(store.reasoning.askNext).toHaveLength(3);
    expect(store.reasoning.askNext.every((a) => a.status === 'open')).toBe(true);
  });

  it('filters red-flag findingIds to real findings', () => {
    const store = seededStore(['f1']);
    store.applyReasoning(
      [dx({ id: 'd1', evidenceFor: ['f1'] })],
      [],
      [{ label: 'ACS', why: 'exclude', findingIds: ['f1', 'ghost'] }],
    );
    expect(store.reasoning.redFlags[0]!.findingIds).toEqual(['f1']);
  });

  it('is idempotent — re-applying the same reasoning does not bump the version', () => {
    const store = seededStore(['f1']);
    store.applyReasoning([dx({ id: 'd1', evidenceFor: ['f1'] })]);
    expect(store.commitReasoning().changed).toBe(true);
    store.applyReasoning([dx({ id: 'd1', evidenceFor: ['f1'] })]);
    expect(store.commitReasoning().changed).toBe(false);
    expect(store.reasoning.version).toBe(1);
  });
});
