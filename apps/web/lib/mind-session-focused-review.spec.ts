import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectedQuestionsForSession } from '../components/app/MindSessionCloseoutEvidence';
import { deriveMindSessionCloseout } from './mind-session-closeout';

const selection = (sourceSessionId: string | null) => ({
  question: 'How did the practice between sessions feel?',
  rationale: 'Review the agreed exercise.',
  carriedAt: '2026-09-05T10:00:00.000Z',
  sourceSessionId,
});

describe('Mind focused review evidence', () => {
  it('does not treat generated assessment questions as clinician selections', () => {
    const generated = [{ sourceSessionId: 'session-1', question: 'An AI-generated gap' }];
    const selected = selectedQuestionsForSession(generated, 'session-1');
    expect(selected).toEqual([]);
    expect(
      deriveMindSessionCloseout({
        draftStatus: 'COMPLETED',
        noteSigned: false,
        nextQuestionsSelected: selected.length > 0,
      }).steps.nextSessionQuestions,
    ).toBe('PENDING');
  });

  it('counts only explicit picks attributed to the current encounter', () => {
    const selected = selectedQuestionsForSession(
      [selection('session-1'), selection('session-2'), selection(null), null],
      'session-1',
    );
    expect(selected).toEqual([selection('session-1')]);
  });

  it('does not complete an earlier encounter from later saved questions', () => {
    const selected = selectedQuestionsForSession([selection('session-2')], 'session-1');
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: true,
      nextQuestionsSelected: selected.length > 0,
    });
    expect(closeout.steps.nextSessionQuestions).toBe('PENDING');
  });

  it('keeps a deliberate skip distinct from selecting a question', () => {
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: true,
      nextQuestionsSelected: false,
      nextQuestionsSkipped: true,
    });
    expect(closeout.steps.nextSessionQuestions).toBe('SKIPPED');
  });

  it('tolerates old or malformed client question state', () => {
    for (const value of [null, undefined, {}, 'not an array', [selection(null)]]) {
      expect(selectedQuestionsForSession(value, 'session-1')).toEqual([]);
    }
  });
});

describe('Mind-only focused review boundaries', () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

  it('guards the vertical and capabilities before loading clinical data', () => {
    const page = read('app/app/sessions/[id]/page.tsx');
    const load = page.indexOf('prisma.session.findFirst');
    expect(page.indexOf("therapist.vertical === 'DOCTOR'")).toBeLessThan(load);
    expect(page.indexOf("canOpenMindPage('session'")).toBeLessThan(load);
    expect(page).toContain('where: { id, psychologistId: therapist.id }');
    expect(page).toContain("effective.capabilities.has('PATIENT_SHARING')");
  });

  it('places the note before next-step decisions and keeps one focused signing surface', () => {
    const closeout = read('components/app/MindSessionCloseout.tsx');
    expect(closeout.indexOf('{children}', closeout.indexOf('return ('))).toBeLessThan(
      closeout.indexOf('id="session-next-steps"'),
    );
    const notes = read('components/app/NotesTab.tsx');
    expect(notes).toContain('focusedReview = false');
    expect(notes.match(/showSign={!focusedReview}/g)).toHaveLength(2);
    expect(notes).toContain('focusedReview ? onSignOnly : onSignAndSend');
    expect(notes).toContain('Signing saves your clinical record. Sharing is a separate choice.');
    for (const doctorFile of ['DoctorEncounterPanel.tsx', 'ReviewAndSign.tsx']) {
      expect(read(`components/app/${doctorFile}`)).not.toContain('focusedReview');
    }
  });
});
