import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NoteReadiness } from '../components/app/NoteReadiness';
import { MindSessionCloseout } from '../components/app/MindSessionCloseout';
import { deriveMindSessionCloseout } from './mind-session-closeout';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', props, children),
}));
vi.mock('../components/app/ScheduleSessionPanel', () => ({
  ScheduleSessionPanel: () => React.createElement('div', null, 'SCHEDULE FORM'),
}));
vi.mock('../components/app/MindSessionAgreements', () => ({
  MindSessionAgreements: () => React.createElement('div', null, 'CANONICAL AGREEMENTS'),
}));
vi.mock('../components/app/ShareReceiptList', () => ({
  ShareReceiptList: () => React.createElement('div', null, 'SHARE RECEIPTS'),
}));
beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const renderCloseout = (
  signed: boolean,
  initialReviewOpen = false,
  canReviewClinical = true,
  draftStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | null = 'COMPLETED',
  hasSignedNote = signed,
) =>
  renderToStaticMarkup(
    React.createElement(MindSessionCloseout, {
      sessionId: 'fictional-session',
      closeout: deriveMindSessionCloseout({ draftStatus, noteSigned: signed }),
      client: { id: 'fictional-client', fullName: 'Fictional client', preferredModality: null },
      sessionAt: new Date('2026-09-09T09:00:00Z'),
      sessionCompleted: true,
      canShare: true,
      receipts: [],
      canReviewClinical,
      initialReviewOpen,
      hasSignedNote,
      clinicalReview: React.createElement('div', null, 'ONE CLINICAL SUPPORT SURFACE'),
      children: React.createElement('article', null, 'PRIMARY NOTE'),
    }),
  );

describe('Mind note-first review and honest trust messages', () => {
  it('describes the limited checks instead of authorising a signature', () => {
    const html = renderToStaticMarkup(React.createElement(NoteReadiness, { items: [] }));
    expect(html).toContain('Basic completeness checks passed. Review accuracy before signing.');
    expect(html).toContain('What was checked?');
    expect(html).toContain('text presence and length');
    expect(html).toContain('do not verify what happened');
    expect(html).not.toContain('good to sign');
  });
  it('keeps actual missing-content and risk hints visible', () => {
    const html = renderToStaticMarkup(
      React.createElement(NoteReadiness, {
        items: [{ label: 'Safety flag recorded', hint: 'Review against the session' }],
      }),
    );
    expect(html).toContain('Safety flag recorded');
    expect(html).not.toContain('checks passed');
  });
  it('shows the note first, does not mount optional clinical support by default, and keeps one agreement editor', () => {
    const html = renderCloseout(false);
    expect(html.indexOf('PRIMARY NOTE')).toBeLessThan(html.indexOf('id="session-support"'));
    expect(html.indexOf('PRIMARY NOTE')).toBeLessThan(html.indexOf('Before you finish'));
    expect(html).not.toContain('ONE CLINICAL SUPPORT SURFACE');
    expect(html.match(/CANONICAL AGREEMENTS/g)).toHaveLength(1);
    expect(html).toContain('The note is the only required review');
    expect(html).toContain('Review any safety alert shown with the note before signing');
    expect(html).toContain('Diagnostic evidence and questions');
    expect(html).not.toContain('Safety, diagnosis and questions');
    expect(html).toContain('Leaving an option untouched records no clinical decision');
    expect(html).not.toContain('type="checkbox"');
  });
  it('opens the legacy deep-link support once without implicitly reviewing anything', () => {
    const html = renderCloseout(false, true);
    expect(html.match(/ONE CLINICAL SUPPORT SURFACE/g)).toHaveLength(1);
    expect(html).toContain('opening this panel does not mark it reviewed');
    expect(html).toContain('No decision recorded');
  });
  it('does not show clinical support for a documentation-only account', () => {
    const html = renderCloseout(false, true, false);
    expect(html).not.toContain('ONE CLINICAL SUPPORT SURFACE');
    expect(html).not.toContain('Open session support');
    expect(html).toContain('PRIMARY NOTE');
  });
  it('lets signed-note users return to Today while all optional decisions remain undecided', () => {
    const html = renderCloseout(true);
    expect(html).toContain('Signed clinical record');
    expect(html).toContain('No decision recorded');
    expect(html).toContain('Return to Today');
    expect(html).not.toContain('Ready for the next chapter');
    expect(html).not.toContain('your next-step decisions are saved');
  });
  it('reports generating, failed, and reopened notes without claiming a new draft is ready', () => {
    const generating = renderCloseout(false, false, true, 'IN_PROGRESS');
    expect(generating).toContain('The note is still being prepared');
    expect(generating).toContain('Preparing');
    expect(generating).not.toContain('This draft was prepared');

    const failed = renderCloseout(false, false, true, 'FAILED');
    expect(failed).toContain('The note could not be prepared');
    expect(failed).toContain('Needs attention');
    expect(failed).not.toContain('This draft was prepared');

    const reopened = renderCloseout(false, false, true, 'COMPLETED', true);
    expect(reopened).toContain('previously signed note is open for correction');
    expect(reopened).toContain('Re-lock');
  });
  it('uses the canonical deep link so clinical support opens when selected from the rail', () => {
    const html = renderCloseout(false);
    expect(html).toContain(
      '/app/sessions/fictional-session?tab=note&amp;support=clinical#session-support',
    );
  });
  it('keeps saved-draft exits behind actual write/recovery state and preserves the agreement unsaved guard', () => {
    const notes = readFileSync(join(import.meta.dirname, '../components/app/NotesTab.tsx'), 'utf8');
    expect(notes).toContain("!blocked && !signing && recoveryStatus === 'none'");
    expect(notes).toContain('Leave as a saved unsigned draft');
    const agreements = readFileSync(
      join(import.meta.dirname, '../components/app/MindSessionAgreements.tsx'),
      'utf8',
    );
    expect(agreements).toMatch(/useUnsavedWorkGuard\(\s*dirty,/);
    expect(agreements).toContain('Save separate amendment');
    expect(agreements).toContain('Correction history');
  });
  it('does not infer assessment completion from an empty generated question list or mislabel a draft map', () => {
    const board = readFileSync(
      join(import.meta.dirname, '../components/app/CopilotDecisionBoard.tsx'),
      'utf8',
    );
    expect(board).not.toContain('Assessment complete');
    expect(board).not.toContain('differential has resolved');
    expect(board).toContain('No further questions suggested by this draft.');
    expect(board).toContain('This does not mean the assessment is complete');
    const page = readFileSync(
      join(import.meta.dirname, '../app/app/sessions/[id]/page.tsx'),
      'utf8',
    );
    expect(page).toContain('sourceSigned = signedRow?.locked === true');
    expect(page).toContain("sourceState={sourceSigned ? 'signed' : 'draft'}");
  });
});
