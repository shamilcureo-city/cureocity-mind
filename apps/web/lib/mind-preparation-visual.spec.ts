import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrepareSummaryV1Schema } from '@cureocity/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MindPreparationBriefing } from '../components/app/MindPreparationBriefing';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', props, children),
}));
beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const base = () =>
  PrepareSummaryV1Schema.parse({
    version: 'V1',
    clientId: `c${'1'.repeat(24)}`,
    cachedBrief: null,
    briefGeneratedAt: null,
    briefIsStale: false,
    journey: { stage: 'INTAKE', activePlan: null, instrumentChanges: [], nextBestAction: null },
    homework: [],
    openCrises: [],
    lastCompletedSessionId: null,
  });
const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

describe('Mind preparation visual presentation', () => {
  it('shows honest empty context rather than fictional recap, homework or outcome', () => {
    const html = renderToStaticMarkup(
      React.createElement(MindPreparationBriefing, { data: base() }),
    );
    expect(html).toContain('No previous session recap');
    expect(html).toContain('No recent practice task is recorded');
    expect(html).toContain('No current AI preparation suggestion');
    expect(html).not.toContain('Ananya');
    expect(html).not.toContain('recovery score');
  });
  it('shows actual assignment wording, status and date without interpreting adherence', () => {
    const data = base();
    data.homework = [
      {
        id: 'cassignment000000000000001',
        description: 'Ask what was manageable',
        status: 'PENDING',
        assignedAt: '2026-10-05T12:00:00.000Z',
        completedAt: null,
        dueAt: null,
      },
    ];
    const html = renderToStaticMarkup(React.createElement(MindPreparationBriefing, { data }));
    expect(html).toContain('Ask what was manageable');
    expect(html).toContain('Recorded status: pending');
    expect(html).toContain('assigned');
    expect(html).toContain('saved status is not a new assessment');
  });
  it('does not label a stale summary as the last session or project its suggested agenda', () => {
    const data = base();
    // The renderer only consumes these existing brief fields; no model call is involved.
    data.cachedBrief = {
      lastSessionRecap: 'An earlier conversation',
      todaysFocus: 'Outdated direction',
    } as NonNullable<typeof data.cachedBrief>;
    data.briefIsStale = true;
    data.briefGeneratedAt = '2026-09-10T12:00:00.000Z';
    data.lastCompletedSessionId = 'clatest0000000000000000001';
    const html = renderToStaticMarkup(React.createElement(MindPreparationBriefing, { data }));
    expect(html).toContain('Saved recap');
    expect(html).toContain('out of date');
    expect(html).not.toContain('At the last session');
    expect(html).not.toContain('Outdated direction');
    expect(html).not.toContain('/app/sessions/clatest');
  });
  it('keeps the live setup controls, source states and saved-focus guards on the actual screen', () => {
    const confirm = read('components/app/RecordConfirmStrip.tsx');
    const prepare = read('components/app/PreparePanel.tsx');
    expect(confirm).toContain('mind-visual-workspace');
    expect(confirm).toContain('presentation="briefing"');
    expect(confirm).toContain('onPendingChange={setPreparationPending}');
    expect(confirm).toContain('onDirtyChange={setPreparationDirty}');
    expect(confirm).toContain('How would you like to work?');
    expect(confirm).toContain('disabled={guideLoading || guideError}');
    expect(prepare).toContain('<PrepareSafety openCrises={data.openCrises}');
    expect(prepare).toContain('Preparation and safety context could not be loaded.');
    expect(prepare).toContain('summaryVisible && data');
  });
  it('limits new tokens to opted-in Mind screens and retains the Scribe route boundary', () => {
    const css = read('app/app/mind-workspace.css');
    const layout = read('app/app/layout.tsx');
    const entry = read('app/app/encounters/new/page.tsx');
    expect(css).toContain('.mind-workspace-shell:has(.mind-visual-workspace)');
    expect(layout).toContain("psy?.vertical === 'THERAPIST' ? 'mind-workspace-shell' : ''");
    expect(entry).toContain("if (therapist.vertical === 'DOCTOR') redirect('/app/clinic')");
  });
});
