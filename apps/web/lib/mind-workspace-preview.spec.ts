import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFound, PreviewFixture } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('PREVIEW_NOT_FOUND');
  }),
  PreviewFixture: vi.fn(() => null),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/app/dev/mind-workspace/MindWorkspacePreview', () => ({
  MindWorkspacePreview: PreviewFixture,
}));

import MindWorkspacePreviewPage, { metadata } from '@/app/dev/mind-workspace/page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('local Mind workspace preview gate', () => {
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    [undefined, 'true'],
    ['development', undefined],
    ['development', 'false'],
    ['development', 'TRUE'],
    ['development', '1'],
  ])('returns not found for NODE_ENV=%s and flag=%s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', flag);

    expect(() => MindWorkspacePreviewPage()).toThrow('PREVIEW_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
    expect(PreviewFixture).not.toHaveBeenCalled();
  });

  it('renders only with exact development and true, without mounting any backend component', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MIND_WORKSPACE_PREVIEW', 'true');
    // Unit tests do not load the Next compiler's automatic JSX runtime.
    vi.stubGlobal('React', React);

    expect(MindWorkspacePreviewPage().type).toBe(PreviewFixture);
    expect(notFound).not.toHaveBeenCalled();
    expect(PreviewFixture).not.toHaveBeenCalled();
  });

  it('keeps the local gallery out of search indexes', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
