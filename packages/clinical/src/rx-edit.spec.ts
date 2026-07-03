import { describe, expect, it } from 'vitest';
import type { RxPadV1 } from '@cureocity/contracts';
import { rxEditCount, rxWithinOneEdit } from './rx-edit';

type RxMed = RxPadV1['meds'][number];
function med(over: Partial<RxMed> & Pick<RxMed, 'drug'>): RxMed {
  return { continued: false, status: 'confirmed', warnings: [], ...over };
}

describe('rxEditCount / rxWithinOneEdit', () => {
  it('is zero when the signed pad equals the drafted pad', () => {
    const meds = [med({ drug: 'Aspirin', strength: '75 mg', frequency: '0-0-1' })];
    expect(rxEditCount(meds, meds)).toBe(0);
    expect(rxWithinOneEdit(meds, meds)).toBe(true);
  });

  it('counts a declined (dropped) drug as one edit', () => {
    const drafted = [med({ drug: 'Aspirin' }), med({ drug: 'Atorvastatin' })];
    const signed = [med({ drug: 'Aspirin' })];
    expect(rxEditCount(drafted, signed)).toBe(1);
    expect(rxWithinOneEdit(drafted, signed)).toBe(true);
  });

  it('counts two dropped drugs as two edits (fails the ≤1 gate)', () => {
    const drafted = [med({ drug: 'A' }), med({ drug: 'B' }), med({ drug: 'C' })];
    const signed = [med({ drug: 'A' })];
    expect(rxEditCount(drafted, signed)).toBe(2);
    expect(rxWithinOneEdit(drafted, signed)).toBe(false);
  });

  it('counts an added drug as one edit', () => {
    const drafted = [med({ drug: 'Aspirin' })];
    const signed = [med({ drug: 'Aspirin' }), med({ drug: 'Clopidogrel' })];
    expect(rxEditCount(drafted, signed)).toBe(1);
  });

  it('counts a dose change on a kept drug as one edit', () => {
    const drafted = [med({ drug: 'Amlodipine', strength: '5 mg', frequency: '1-0-0' })];
    const signed = [med({ drug: 'Amlodipine', strength: '10 mg', frequency: '1-0-0' })];
    expect(rxEditCount(drafted, signed)).toBe(1);
  });

  it('counts a frequency change as one edit', () => {
    const drafted = [med({ drug: 'Metformin', frequency: '1-0-0' })];
    const signed = [med({ drug: 'Metformin', frequency: '1-0-1' })];
    expect(rxEditCount(drafted, signed)).toBe(1);
  });

  it('normalises [mock] tags, casing + whitespace (no false edits)', () => {
    const drafted = [med({ drug: '[mock] Aspirin', strength: '75 MG', frequency: '0-0-1' })];
    const signed = [med({ drug: 'aspirin', strength: '75 mg', frequency: '0-0-1' })];
    expect(rxEditCount(drafted, signed)).toBe(0);
  });

  it('ignores rows with an empty drug name', () => {
    const drafted = [med({ drug: 'Aspirin' }), med({ drug: '   ' })];
    const signed = [med({ drug: 'Aspirin' })];
    expect(rxEditCount(drafted, signed)).toBe(0);
  });

  it('treats undefined/empty pads as no meds', () => {
    expect(rxEditCount(undefined, undefined)).toBe(0);
    expect(rxEditCount([], [med({ drug: 'Aspirin' })])).toBe(1);
  });
});
