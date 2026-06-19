import { describe, expect, it } from 'vitest';
import {
  missingTemplateElements,
  resolveSpecialtyTemplate,
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
});
