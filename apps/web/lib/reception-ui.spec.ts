import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFound, requireOnboardedPsychologist, Workspace, PublicDesk, Preview } = vi.hoisted(
  () => ({
    notFound: vi.fn(() => {
      throw new Error('RECEPTION_NOT_FOUND');
    }),
    requireOnboardedPsychologist: vi.fn(),
    Workspace: vi.fn(() => null),
    PublicDesk: vi.fn(() => null),
    Preview: vi.fn(() => null),
  }),
);

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/auth-page', () => ({ requireOnboardedPsychologist }));
vi.mock('@/components/reception/ReceptionWorkspace', () => ({ ReceptionWorkspace: Workspace }));
vi.mock('@/components/reception/PublicReception', () => ({ PublicReception: PublicDesk }));
vi.mock('@/components/reception/ReceptionPreview', () => ({ ReceptionPreview: Preview }));

import ReceptionPage from '@/app/app/reception/page';
import PublicReceptionPage, { metadata as publicMetadata } from '@/app/reception/[slug]/page';
import ReceptionPreviewPage, { metadata as previewMetadata } from '@/app/dev/reception/page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('reception page release boundaries', () => {
  it.each([undefined, 'false', 'TRUE', '1'])(
    'keeps owner and public reception closed for flag %s',
    async (flag) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', flag);
      await expect(ReceptionPage()).rejects.toThrow('RECEPTION_NOT_FOUND');
      await expect(
        PublicReceptionPage({ params: Promise.resolve({ slug: 'sample-practice' }) }),
      ).rejects.toThrow('RECEPTION_NOT_FOUND');
      expect(requireOnboardedPsychologist).not.toHaveBeenCalled();
    },
  );

  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'requires an onboarded owner and uses their stored %s vertical',
    async (vertical) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
      vi.stubGlobal('React', React);
      requireOnboardedPsychologist.mockResolvedValue({ vertical });
      const page = await ReceptionPage();
      expect(requireOnboardedPsychologist).toHaveBeenCalledOnce();
      expect(page.type).toBe(Workspace);
      expect(page.props).toEqual({ vertical });
    },
  );

  it('passes only the public slug to the receptionist page', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    vi.stubGlobal('React', React);
    const page = await PublicReceptionPage({
      params: Promise.resolve({ slug: 'sample-practice' }),
    });
    expect(page.type).toBe(PublicDesk);
    expect(page.props).toEqual({ slug: 'sample-practice' });
    expect(requireOnboardedPsychologist).not.toHaveBeenCalled();
    expect(publicMetadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('reception local fixture boundary', () => {
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    [undefined, 'true'],
    ['development', undefined],
    ['development', 'false'],
    ['development', 'TRUE'],
    ['development', '1'],
  ])('keeps preview closed for environment %s and flag %s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('RECEPTION_WORKSPACE_PREVIEW', flag);
    expect(() => ReceptionPreviewPage()).toThrow('RECEPTION_NOT_FOUND');
    expect(Preview).not.toHaveBeenCalled();
  });

  it('enables the fixture only in opted-in development without requiring auth or live APIs', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RECEPTION_WORKSPACE_PREVIEW', 'true');
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    vi.stubGlobal('React', React);
    expect(ReceptionPreviewPage().type).toBe(Preview);
    expect(requireOnboardedPsychologist).not.toHaveBeenCalled();
    expect(previewMetadata.robots).toEqual({ index: false, follow: false });
  });
});
