import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFound, Fixture } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('PREVIEW_NOT_FOUND');
  }),
  Fixture: vi.fn(() => null),
}));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/app/dev/mind-work-history/MindWorkHistoryPreview', () => ({
  MindWorkHistoryPreview: Fixture,
}));
import PreviewPage, { metadata } from '@/app/dev/mind-work-history/page';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('Mind work-history integration boundaries', () => {
  it('keeps history in the therapist client page and rejects the doctor journey first', () => {
    const page = source('../app/app/clients/[id]/page.tsx');
    expect(page).toContain("therapist.vertical === 'DOCTOR'");
    expect(page.indexOf("redirect('/app/clinic')")).toBeLessThan(page.indexOf('<MindWorkHistory'));
    expect(page).toContain('id="work-history"');
    expect(page).toContain('key={`work-history-${client.id}`} clientId={client.id}');
  });
  it('shows source history alongside explicit work without removing the editor or its capability', () => {
    const closeout = source('../components/app/MindSessionCloseout.tsx');
    const work = closeout.slice(closeout.indexOf('work={'), closeout.indexOf('agreements={'));
    expect(work).toContain('canRecordWork &&');
    expect(work).toContain('<MindCareRecordPanel');
    expect(work).toContain('sessionContext={{ sessionId, scheduledAt: sessionAt.toISOString() }}');
    expect(work).toContain('<MindWorkHistory');
    expect(source('../components/app/MindCareContinuitySummary.tsx')).toContain('#work-history');
  });
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    ['development', undefined],
    ['development', 'false'],
  ])('hides preview in %s with flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', flag);
    expect(() => PreviewPage()).toThrow('PREVIEW_NOT_FOUND');
    expect(Fixture).not.toHaveBeenCalled();
  });
  it('only renders the unindexed preview with exact local opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', 'true');
    vi.stubGlobal('React', React);
    expect(PreviewPage().type).toBe(Fixture);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('closes fictional transport over local responses with no network or persistent storage', () => {
    const fixture = source('../app/dev/mind-work-history/MindWorkHistoryPreview.tsx');
    expect(fixture).toContain('request={request}');
    expect(fixture).not.toMatch(/\bfetch\s*\(|localStorage|sessionStorage|getUserMedia/);
    expect(fixture).toContain("scenario === 'unavailable'");
    expect(fixture).toContain("scenario === 'empty'");
  });
});
