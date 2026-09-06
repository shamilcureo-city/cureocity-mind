import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClinicalPlanSuggestionSchema,
  ClinicalTreatmentPlanSchema,
  IntakeNoteV1Schema,
  TherapyNoteV1Schema,
} from '@cureocity/contracts';
import {
  canonicalIntakeEdit,
  canonicalTreatmentEdit,
  noteEditIsDirty,
} from './canonical-note-edit';
import { createPlanSuggestionState, resolvePlanSuggestionDecision } from './plan-suggestion-state';
import { selectedQuestionsForSession } from '../components/app/MindSessionCloseoutEvidence';
import { deriveMindSessionCloseout } from './mind-session-closeout';
import { transcriptIsProcessing } from './transcript-state';

const plan = ClinicalTreatmentPlanSchema.parse({
  modality: 'CBT',
  phaseSequence: ['Assessment', 'Practice'],
  goals: ['A', 'B', 'C', 'D'].map((description) => ({
    description,
    measure: 'Review next session',
  })),
  expectedDurationSessions: 8,
});
const suggestion = (value: Record<string, unknown>) =>
  ClinicalPlanSuggestionSchema.parse({ rationale: 'Reviewed evidence', ...value });
const remove = suggestion({ type: 'REMOVE_GOAL', goalIndex: 0 });
const revise = suggestion({
  type: 'REVISE_GOAL',
  goalIndex: 1,
  goal: { description: 'B updated', measure: 'Review next session' },
});
const add = suggestion({
  type: 'ADD_GOAL',
  goal: { description: 'New goal', measure: 'Review next session' },
});
const initial = createPlanSuggestionState({ id: 'plan-1', body: plan }, 'revision-1')!;
const decide = (state = initial, indexes = [0], suggestions = [remove, revise]) =>
  resolvePlanSuggestionDecision({
    state,
    suggestions,
    requestedIndexes: indexes,
    revision: state.revision,
    expectedPlanId: state.currentPlanId,
    activePlanId: state.currentPlanId,
  });

describe('immutable plan suggestion decisions', () => {
  it('keeps original goal identity when remove and revise are accepted separately', () => {
    const first = decide();
    const state = { ...initial, currentPlanId: 'plan-2', appliedIndexes: first.appliedIndexes };
    const separate = decide(state, [1]);
    const together = decide(initial, [0, 1]);
    expect(separate.plan).toEqual(together.plan);
    expect(separate.plan.goals.map((goal) => goal.description)).toEqual(['B updated', 'C', 'D']);
    expect(initial.basePlan.goals.map((goal) => goal.description)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('returns a duplicate receipt without adding a goal twice after reload', () => {
    const first = decide(initial, [0], [add]);
    const persisted = JSON.parse(
      JSON.stringify({ ...initial, currentPlanId: 'plan-2', appliedIndexes: first.appliedIndexes }),
    );
    const retry = decide(persisted, [0], [add]);
    expect(retry.duplicate).toBe(true);
    expect(retry.plan.goals.filter((goal) => goal.description === 'New goal')).toHaveLength(1);
  });
  it('rejects stale report or active plan identities without guessing', () => {
    const args = {
      state: initial,
      suggestions: [remove],
      requestedIndexes: [0],
      revision: initial.revision,
      expectedPlanId: initial.currentPlanId,
      activePlanId: initial.currentPlanId,
    };
    expect(() => resolvePlanSuggestionDecision({ ...args, revision: 'old' })).toThrow(
      /suggestions have changed/,
    );
    expect(() =>
      resolvePlanSuggestionDecision({ ...args, activePlanId: 'edited-elsewhere' }),
    ).toThrow(/plan changed/);
    expect(() => resolvePlanSuggestionDecision({ ...args, expectedPlanId: 'old' })).toThrow(
      /plan changed/,
    );
  });
  it('refuses two conflicting actions on the same original goal', () => {
    expect(() => decide(initial, [0, 1], [remove, remove])).toThrow(/conflict/);
  });
  describe.each([
    {
      setting: 'treatment duration',
      proposals: [6, 12].map((expectedDurationSessions) =>
        suggestion({ type: 'ADJUST_DURATION', expectedDurationSessions }),
      ),
    },
    {
      setting: 'treatment modality',
      proposals: ['EMDR', 'supportive'].map((modality) =>
        suggestion({ type: 'CHANGE_MODALITY', modality }),
      ),
    },
  ])('$setting conflict', ({ setting, proposals }) => {
    it('rejects conflicting proposals in one batch without changing the baseline', () => {
      const before = structuredClone(initial);
      expect(() => decide(initial, [0, 1], proposals)).toThrow(`conflict on ${setting}`);
      expect(initial).toEqual(before);
    });
    it('rejects a lower-index proposal after a conflicting higher index was accepted', () => {
      const first = decide(initial, [1], proposals);
      const persisted = {
        ...initial,
        currentPlanId: 'plan-2',
        appliedIndexes: first.appliedIndexes,
      };
      const before = structuredClone(persisted);
      expect(() => decide(persisted, [0], proposals)).toThrow(`conflict on ${setting}`);
      expect(persisted).toEqual(before);
      expect(persisted.appliedIndexes).toEqual([1]);
      expect(decide(persisted, [1], proposals).duplicate).toBe(true);
    });
  });
  it('still permits independent duration, modality and goal changes together', () => {
    const proposals = [
      suggestion({ type: 'ADJUST_DURATION', expectedDurationSessions: 6 }),
      suggestion({ type: 'CHANGE_MODALITY', modality: 'EMDR' }),
      remove,
    ];
    const result = decide(initial, [0, 1, 2], proposals);
    expect(result.plan.expectedDurationSessions).toBe(6);
    expect(result.plan.modality).toBe('EMDR');
    expect(result.plan.goals.map((goal) => goal.description)).toEqual(['B', 'C', 'D']);
    expect(result.appliedIndexes).toEqual([0, 1, 2]);
  });
  it('does not invent a baseline for a legacy or malformed plan', () => {
    expect(createPlanSuggestionState(null, 'r')).toBeNull();
    expect(createPlanSuggestionState({ id: 'legacy', body: {} }, 'r')).toBeNull();
  });
});

describe('manual note corrections have one source of truth', () => {
  const note = TherapyNoteV1Schema.parse({
    version: 'V1',
    modality: 'CBT',
    subjective: 'Old account',
    objective: 'Observation',
    assessment: 'Assessment',
    plan: 'Plan',
    summary: 'Old account',
    topics: [{ title: 'Old topic', points: ['Old account'] }],
    templateSections: [{ title: 'Summary', body: 'Old account' }],
    riskFlags: { severity: 'high', indicators: ['Reviewed indicator'] },
  });
  it('clears stale derived views and preserves safety fields when clinical text changes', () => {
    const submitted = {
      ...note,
      subjective: 'Corrected account',
      modality: 'EMDR',
      riskFlags: { severity: 'none', indicators: [] },
    };
    const edited = canonicalTreatmentEdit(note, submitted);
    expect(edited.subjective).toBe('Corrected account');
    expect(edited.summary).toBeUndefined();
    expect(edited.topics).toBeUndefined();
    expect(edited.templateSections).toBeUndefined();
    expect(edited.modality).toBe(note.modality);
    expect(edited.riskFlags).toEqual(note.riskFlags);
    expect(TherapyNoteV1Schema.safeParse(edited).success).toBe(true);
  });
  it('keeps intake fields canonical rather than editing a disconnected template', () => {
    const note = IntakeNoteV1Schema.parse({
      version: 'V1',
      presentingConcerns: 'Concern',
      historyOfPresentingIllness: 'History',
      pastPsychiatricHistory: '',
      familyHistory: '',
      socialHistory: '',
      mentalStatusExam: 'MSE',
      workingHypothesis: 'Hypothesis',
      immediatePlan: 'Plan',
      templateSections: [{ title: 'History', body: 'Old history' }],
      riskFlags: { severity: 'none', indicators: [] },
    });
    const edited = canonicalIntakeEdit(note, {
      ...note,
      historyOfPresentingIllness: 'Corrected history',
    });
    expect(edited.templateSections).toBeUndefined();
    expect(edited.historyOfPresentingIllness).toBe('Corrected history');
    expect(IntakeNoteV1Schema.safeParse(edited).success).toBe(true);
  });
  it('tracks dirty state without persisting patient content in browser storage', () => {
    expect(noteEditIsDirty({ text: 'Saved' }, { text: 'Saved' })).toBe(false);
    expect(noteEditIsDirty({ text: 'Saved' }, { text: 'Unsaved' })).toBe(true);
  });
  it('invalidates generated provenance and phase hints but retains clinical safety and modality observations', () => {
    const original = TherapyNoteV1Schema.parse({
      ...note,
      linkedEvidence: [{ startMs: 0, endMs: 1000, quote: 'Old account' }],
      phaseHints: [{ phase: 'Practice', confidence: 0.8 }],
      modalitySpecific: { clinicianObservation: 'Review with client' },
    });
    const edited = canonicalTreatmentEdit(original, {
      ...original,
      subjective: 'Corrected account',
    });
    expect(edited.linkedEvidence).toEqual([]);
    expect(edited.phaseHints).toEqual([]);
    expect(edited.modalitySpecific).toEqual(original.modalitySpecific);
    expect(edited.riskFlags).toEqual(original.riskFlags);
  });
});

describe('closeout and transcript state', () => {
  it('backfills only missing historical snapshots and excludes erased clients on migration replay', () => {
    const sql = readFileSync(
      join(
        import.meta.dirname,
        '../../../prisma/migrations/20260926000200_mind_closeout_integrity/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('WHERE c."deletedAt" IS NULL');
    expect(sql).toContain('WHERE "mind_session_closeout_states"."nextQuestionsSnapshot" IS NULL');
  });
  it('retains earlier session question decisions after the active queue is cleared', () => {
    const snapshot = [
      {
        question: 'Review practice',
        rationale: null,
        sourceSessionId: 'session-1',
        carriedAt: '2026-09-06T10:00:00.000Z',
      },
    ];
    const selected = selectedQuestionsForSession(snapshot, 'session-1');
    expect(
      deriveMindSessionCloseout({
        draftStatus: 'COMPLETED',
        noteSigned: true,
        nextQuestionsSelected: selected.length > 0,
      }).steps.nextSessionQuestions,
    ).toBe('COMPLETE');
    expect(selectedQuestionsForSession([], 'session-1')).toHaveLength(0);
  });
  it('uses actual processing states and stops for failure/completion', () => {
    expect(transcriptIsProcessing('IN_PROGRESS')).toBe(true);
    expect(transcriptIsProcessing('PENDING')).toBe(true);
    expect(transcriptIsProcessing('FAILED')).toBe(false);
    expect(transcriptIsProcessing('COMPLETED')).toBe(false);
  });
  it('wires manual agreements outside AI status gates and protects note corrections', () => {
    const source = (name: string) =>
      readFileSync(join(import.meta.dirname, '../components/app', name), 'utf8');
    expect(source('MindSessionCloseout.tsx')).toContain('<MindSessionAgreements');
    expect(source('MindSessionAgreements.tsx')).not.toContain('clinical-analysis');
    expect(source('ClinicalFieldsEditor.tsx')).toContain(
      "document.addEventListener('click', navigate, true)",
    );
    expect(source('ClinicalFieldsEditor.tsx')).toContain(
      "window.addEventListener('beforeunload', beforeUnload)",
    );
    expect(source('NotesTab.tsx')).toContain('<NoteTranscriptReference draft={phase.draft} />');
    expect(source('CopilotDecisionBoard.tsx')).not.toContain('Session closed');
  });
});
