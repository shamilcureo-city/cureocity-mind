import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('./auth-page', () => ({
  requireOnboardedPsychologist: async () => ({
    id: 'psy-1',
    vertical: 'THERAPIST',
    defaultCaptureMode: 'LIVE',
  }),
}));
vi.mock('./prisma', () => ({ prisma: { client: { findFirst: mocks.client } } }));
vi.mock('./client-pii', () => ({
  resolveClientPii: async () => ({ fullName: 'Fictional client' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found');
  },
  redirect: () => {
    throw new Error('Redirect');
  },
}));
vi.mock('../components/app/ClientWorkspacePage', () => ({
  ClientWorkspacePage: ({ children }: { children: ReactNode }) =>
    createElement('section', null, children),
}));
import ClientSessionsPage from '../app/app/clients/[id]/sessions/page';

describe('client sessions page status truth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders reopened, signed, pending and unsigned sessions from authoritative note state', async () => {
    vi.stubGlobal('React', React);
    const base = {
      scheduledAt: new Date('2026-09-07T10:00:00.000Z'),
      modality: null,
      captureMode: null,
      status: 'COMPLETED',
    };
    mocks.client.mockResolvedValue({
      id: 'client-1',
      sessions: [
        {
          ...base,
          id: 'signed',
          therapyNote: { id: 'n1', locked: true, signedAt: new Date() },
          noteDraft: { status: 'COMPLETED' },
        },
        {
          ...base,
          id: 'reopened',
          therapyNote: { id: 'n2', locked: false, signedAt: new Date() },
          noteDraft: { status: 'COMPLETED' },
        },
        { ...base, id: 'unsigned', therapyNote: null, noteDraft: { status: 'COMPLETED' } },
        { ...base, id: 'pending', therapyNote: null, noteDraft: { status: 'PENDING' } },
      ],
    });
    const html = renderToStaticMarkup(
      await ClientSessionsPage({ params: Promise.resolve({ id: 'client-1' }) }),
    );
    expect(html.match(/Signed note/g)).toHaveLength(1);
    expect(html).toContain('Reopened — needs signature');
    expect(html).toContain('Unsigned draft');
    expect(html).toContain('Note generation pending');
    expect(mocks.client.mock.calls[0]?.[0].include.sessions.select.therapyNote.select).toEqual({
      id: true,
      locked: true,
      signedAt: true,
    });
  });
});
