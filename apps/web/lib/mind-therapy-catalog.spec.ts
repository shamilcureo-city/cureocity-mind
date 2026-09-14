import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MIND_THERAPY_GUIDE_CATALOG,
  MIND_THERAPY_GUIDE_KIND_LABELS,
  mindTherapyGuideChoice,
  groupMindTherapyGuideChoices,
} from './mind-therapy-catalog';

const legacyNames = [
  'Cognitive Restructuring',
  'Behavioural Activation',
  'Graded Exposure',
  'Mindfulness-Based Cognitive Therapy',
  'Acceptance and Commitment Therapy',
  'Problem-Solving Therapy',
  'Sleep Hygiene + Stimulus Control',
  'EMDR Phase 3 — Assessment',
  'EMDR Phase 4 — Desensitisation',
  'Motivational Interviewing',
];

describe('Mind guide display catalog', () => {
  it('groups the ten starting points without changing names, losing rationale, or classifying unknown names', () => {
    const unknown = { name: 'Fictional new recommendation', rationale: 'Keep this case context' };
    const groups = groupMindTherapyGuideChoices([...MIND_THERAPY_GUIDE_CATALOG, unknown]);
    expect(groups.map((group) => [group.kind, group.choices.length])).toEqual([
      ['approach', 4],
      ['technique', 4],
      ['protocol_stage', 2],
      ['unclassified', 1],
    ]);
    expect(groups.at(-1)!.choices).toEqual([unknown]);
    expect(
      groups
        .flatMap((group) => group.choices)
        .map((choice) => choice.name)
        .sort(),
    ).toEqual([...legacyNames, unknown.name].sort());
    expect(groupMindTherapyGuideChoices([])).toEqual([]);
  });
  it('keeps all ten exact legacy names and their order for request/cache compatibility', () => {
    expect(MIND_THERAPY_GUIDE_CATALOG.map((choice) => choice.name)).toEqual(legacyNames);
    expect(new Set(MIND_THERAPY_GUIDE_CATALOG.map((choice) => choice.id)).size).toBe(10);
  });

  it('distinguishes approach, technique and individual protocol-stage choices', () => {
    expect(MIND_THERAPY_GUIDE_CATALOG.filter((choice) => choice.kind === 'approach')).toHaveLength(
      4,
    );
    expect(MIND_THERAPY_GUIDE_CATALOG.filter((choice) => choice.kind === 'technique')).toHaveLength(
      4,
    );
    expect(
      MIND_THERAPY_GUIDE_CATALOG.filter((choice) => choice.kind === 'protocol_stage'),
    ).toHaveLength(2);
    for (const choice of MIND_THERAPY_GUIDE_CATALOG) {
      expect(MIND_THERAPY_GUIDE_KIND_LABELS[choice.kind]).toBeTruthy();
      expect(mindTherapyGuideChoice(choice.name)).toBe(choice);
    }
  });

  it('marks both existing EMDR stages for the specialist training notice', () => {
    expect(
      MIND_THERAPY_GUIDE_CATALOG.filter((choice) => choice.emdrTrainingNotice).map(
        (choice) => choice.name,
      ),
    ).toEqual(legacyNames.slice(7, 9));
  });

  it('does not fabricate a classification for new model-recommended names', () => {
    expect(mindTherapyGuideChoice('Fictional new recommendation')).toBeUndefined();
    expect(mindTherapyGuideChoice('CBT')).toBeUndefined();
  });

  it('wires the real Plan of Care to the one catalog rather than a duplicate list', () => {
    const source = readFileSync(
      new URL('../components/app/PlanOfCareTab.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('libraryTherapies={MIND_THERAPY_GUIDE_CATALOG}');
    expect(source).not.toContain('const LIBRARY_THERAPIES');
  });
});
