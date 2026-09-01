import { describe, expect, it } from 'vitest';
import { preparationFreshness } from './preparation-freshness';

const now = new Date('2026-08-30T12:00:00.000Z');

describe('preparationFreshness', () => {
  it('labels a recent persisted brief in minutes', () => {
    expect(preparationFreshness('2026-08-30T11:42:00.000Z', false, now)).toEqual({
      tone: 'fresh',
      label: 'Generated 18m ago',
    });
  });

  it('makes stale state explicit while retaining age evidence', () => {
    expect(preparationFreshness('2026-08-29T10:00:00.000Z', true, now)).toEqual({
      tone: 'stale',
      label: 'Stale · generated 1d ago',
    });
  });

  it('does not invent freshness when no brief exists', () => {
    expect(preparationFreshness(null, false, now)).toEqual({
      tone: 'missing',
      label: 'Not generated yet',
    });
  });

  it('treats a malformed persisted timestamp as missing', () => {
    expect(preparationFreshness('not-a-date', false, now)).toEqual({
      tone: 'missing',
      label: 'Generation time unavailable',
    });
  });
});
