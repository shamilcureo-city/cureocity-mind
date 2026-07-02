import { describe, expect, it } from 'vitest';
import {
  missingTemplateElements,
  resolveSpecialtyTemplate,
  templateAskNext,
  type EncounterCompletenessInput,
} from './specialty-templates';

const EMPTY: EncounterCompletenessInput = {
  hpi: '',
  reviewOfSystems: [],
  examined: false,
  examFindings: '',
  presentVitals: [],
};

describe('resolveSpecialtyTemplate', () => {
  it('resolves a known specialty key (case-insensitive)', () => {
    expect(resolveSpecialtyTemplate('Cardiology')?.key).toBe('cardiology');
  });
  it('resolves a contains-match (Interventional Cardiology → cardiology)', () => {
    expect(resolveSpecialtyTemplate('Interventional Cardiology')?.key).toBe('cardiology');
  });
  it('returns null for unknown / missing specialty', () => {
    expect(resolveSpecialtyTemplate('Dermatology')).toBeNull();
    expect(resolveSpecialtyTemplate(undefined)).toBeNull();
    expect(resolveSpecialtyTemplate(null)).toBeNull();
  });
});

describe('missingTemplateElements', () => {
  const cardiology = resolveSpecialtyTemplate('cardiology');

  it('returns [] when there is no template', () => {
    expect(missingTemplateElements(EMPTY, null)).toEqual([]);
  });

  it('flags all HPI / ROS / vitals elements for an empty cardiology note', () => {
    const gaps = missingTemplateElements(EMPTY, cardiology);
    expect(gaps.some((g) => g.category === 'HPI')).toBe(true);
    expect(gaps.some((g) => g.category === 'VITALS' && g.elementId === 'bp')).toBe(true);
    // exam not flagged when no exam was performed
    expect(gaps.some((g) => g.category === 'EXAM')).toBe(false);
  });

  it('suppresses a HPI nudge when the cue is present', () => {
    const gaps = missingTemplateElements(
      { ...EMPTY, hpi: 'Chest pain on exertion, relieved by rest. No breathlessness.' },
      cardiology,
    );
    expect(gaps.some((g) => g.elementId === 'chest-pain-character')).toBe(false);
    expect(gaps.some((g) => g.elementId === 'exertion')).toBe(false);
    expect(gaps.some((g) => g.elementId === 'dyspnea')).toBe(false);
  });

  it('flags exam elements only once an exam was performed', () => {
    const gaps = missingTemplateElements(
      { ...EMPTY, examined: true, examFindings: 'Apex not displaced.' },
      cardiology,
    );
    // heart-sounds documented via "apex"; jvp + lung-bases still missing
    expect(gaps.some((g) => g.category === 'EXAM' && g.elementId === 'jvp')).toBe(true);
    expect(gaps.some((g) => g.category === 'EXAM' && g.elementId === 'heart-sounds')).toBe(false);
  });

  it('suppresses a vitals nudge when the vital is recorded', () => {
    const gaps = missingTemplateElements({ ...EMPTY, presentVitals: ['bp', 'hr'] }, cardiology);
    expect(gaps.some((g) => g.category === 'VITALS')).toBe(false);
  });

  it('carries the element label on each gap (DS3)', () => {
    const gaps = missingTemplateElements(EMPTY, cardiology);
    expect(gaps.find((g) => g.elementId === 'exertion')?.label).toBe('Relation to exertion');
  });
});

describe('templateAskNext (DS3)', () => {
  const cardiology = resolveSpecialtyTemplate('cardiology');

  it('returns [] when there is no template', () => {
    expect(templateAskNext(EMPTY, null)).toEqual([]);
  });

  it('maps completeness gaps to ask-next items (source TEMPLATE, priority normal, open)', () => {
    const items = templateAskNext(EMPTY, cardiology);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.source).toBe('TEMPLATE');
      expect(it.priority).toBe('normal');
      expect(it.status).toBe('open');
      expect(it.id.startsWith('t-')).toBe(true);
      expect(it.question.endsWith('?')).toBe(true);
    }
    // A recorded vital drops its question.
    const withBp = templateAskNext({ ...EMPTY, presentVitals: ['bp'] }, cardiology);
    expect(withBp.some((i) => i.id === 't-vitals-bp')).toBe(false);
    expect(items.some((i) => i.id === 't-vitals-bp')).toBe(true);
  });
});
