import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MindCareRecordDtoSchema } from '@cureocity/contracts';
import { EMPTY_MIND_CARE_RECORD } from '../components/app/MindCareRecordPanel';
import { sessionWorkPreparation, formatMindWorkDate } from './mind-session-work';

const record = (work?: unknown) =>
  MindCareRecordDtoSchema.parse({
    id: 'record-2',
    clientId: 'client-1',
    version: 2,
    operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5',
    createdAt: '2026-09-13T12:00:00.000Z',
    body: { ...EMPTY_MIND_CARE_RECORD, ...(work ? { sessionWork: work } : {}) },
  });
const work = {
  sessionId: 'older-visit',
  scheduledAt: '2026-09-10T09:00:00.000Z',
  disposition: 'PAUSED',
  workDone: 'Fictional work paused as agreed.',
  clientResponse: '',
};
describe('source-aware next-visit work context', () => {
  it('displays the source date in explicit IST rather than the browser time zone', () => {
    expect(formatMindWorkDate('2026-09-10T23:30:00.000Z')).toContain('11 Sept 2026');
    expect(formatMindWorkDate('2026-09-10T23:30:00.000Z')).toMatch(/5:00\s*am IST$/i);
  });
  it('does not manufacture work from empty or legacy care records', () => {
    expect(sessionWorkPreparation(null)).toBeNull();
    expect(sessionWorkPreparation(record())).toBeNull();
  });
  it('keeps source-visit date distinct from care-record save date and missing response distinct from improvement', () => {
    expect(sessionWorkPreparation(record(work))).toMatchObject({
      sessionId: 'older-visit',
      scheduledAt: work.scheduledAt,
      recordSavedAt: '2026-09-13T12:00:00.000Z',
      recordVersion: 2,
      disposition: 'Work started, then paused',
      workDone: work.workDone,
      clientResponse: 'Not recorded; no response or improvement is inferred.',
      sourceHref: '/app/sessions/older-visit',
    });
  });
  it('preserves the clinician-entered response without interpreting it as an outcome score', () => {
    expect(
      sessionWorkPreparation(record({ ...work, clientResponse: 'Response not yet discussed.' }))
        ?.clientResponse,
    ).toBe('Response not yet discussed.');
  });
  it('wires only explicit clinical entry and read-only preparation, including server-dated manual sessions', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../components/app/PreparePanel.tsx')).toContain('<MindCareContinuitySummary');
    const summary = read('../components/app/MindCareContinuitySummary.tsx');
    expect(summary).toContain('not necessarily the latest visit');
    expect(summary.replace(/\s+/g, ' ')).toContain('It has not been sent to live AI.');
    expect(summary).not.toMatch(/method:\s*['"]POST|generate|localStorage|sessionStorage/);
    const manual = read('../components/app/MindManualSession.tsx');
    expect(manual).toContain('scheduledAt: sessionScheduledAt');
    expect(read('../app/app/sessions/[id]/page.tsx')).toContain(
      'sessionScheduledAt={session.scheduledAt.toISOString()}',
    );
    expect(read('../components/app/MindCareRecordPanel.tsx')).toContain('Confirm work & save');
  });
});
