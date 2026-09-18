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
vi.mock('@/app/dev/mind-review/MindReviewPreview', () => ({ MindReviewPreview: Fixture }));
import PreviewPage, { metadata } from '@/app/dev/mind-review/page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('fictional review preview boundary', () => {
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    [undefined, 'true'],
    ['development', undefined],
    ['development', 'false'],
    ['development', 'TRUE'],
  ])('is unavailable with environment %s and flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', flag);
    expect(() => PreviewPage()).toThrow('PREVIEW_NOT_FOUND');
    expect(Fixture).not.toHaveBeenCalled();
  });
  it('renders only with the exact local development opt-in and stays unindexed', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', 'true');
    vi.stubGlobal('React', React);
    expect(PreviewPage().type).toBe(Fixture);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('uses the production review shell with a closed fictional transport', () => {
    const source = readFileSync(
      new URL('../app/dev/mind-review/MindReviewPreview.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('transport={transport}');
    expect(source).toContain('<MindSessionPhaseRail active="review" />');
    expect(source).toContain('<MindSessionReviewHeader');
    expect(source).toContain('<SessionWorkspaceTabs');
    expect(source).toContain('<MindSessionCloseout');
    expect(source).toContain('decisionActions={');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toContain('canShare={false}');
    expect(source).toContain('canReviewClinical={false}');
    expect(source).toContain('canRecordWork={false}');
    expect(source).toContain('pdfHref={null}');
    expect(source).toContain('dirty: text !== savedAgreement');
    expect(source).not.toMatch(/getUserMedia|localStorage|sessionStorage/);
  });
});
