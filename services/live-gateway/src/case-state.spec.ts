import { describe, expect, it } from 'vitest';
import type { ClinicalFinding } from '@cureocity/contracts';
import { CaseStateStore } from './case-state';

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
