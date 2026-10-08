import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  session: vi.fn(),
  decrypt: vi.fn(),
  guard: vi.fn(),
  redirect: vi.fn((href: string): never => {
    throw new Error(`REDIRECT:${href}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('./auth-page', () => ({ requireOnboardedDoctor: h.guard }));
vi.mock('./client-pii', () => ({ decryptClientField: h.decrypt }));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: h.session } } }));
vi.mock('./scribe-teleconsult-links', () => ({ isScribeTeleconsultEnabled: () => true }));
vi.mock('../components/app/DoctorEncounterPanel', () => ({
  DoctorEncounterPanel: 'encounter-panel',
}));
vi.mock('../components/app/LiveEncounterFlow', () => ({ LiveEncounterFlow: 'live-flow' }));
import LivePage from '../app/app/patients/[id]/encounters/[sessionId]/live/page';
import Workspace from '../app/app/patients/[id]/encounters/[sessionId]/page';
const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...elements(child.props.children as ReactNode)]
      : [],
  );
const props = {
  params: Promise.resolve({ id: 'client', sessionId: 'session' }),
  searchParams: Promise.resolve({ mode: 'upload' }),
};
const base = {
  id: 'session',
  clientId: 'client',
  psychologistId: 'owner',
  status: 'SCHEDULED',
  captureMode: null,
  consentSnapshot: null,
  client: { fullNameEncrypted: 'fictional', dateOfBirth: null },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  h.guard.mockResolvedValue({ id: 'owner', specialty: 'family medicine' });
  h.session.mockResolvedValue({ ...base });
  h.decrypt.mockResolvedValue('Fictional patient');
});
afterEach(() => vi.unstubAllGlobals());
describe('encounter pages preserve the persisted capture workflow', () => {
  it.each(['DICTATE', 'UPLOAD', null])(
    'redirects active %s sessions out of live capture before reading patient PII',
    async (captureMode) => {
      h.session.mockResolvedValue({ ...base, status: 'IN_PROGRESS', captureMode });
      await expect(LivePage({ ...props, searchParams: Promise.resolve({}) })).rejects.toThrow(
        'REDIRECT:/app/patients/client/encounters/session',
      );
      expect(h.decrypt).not.toHaveBeenCalled();
    },
  );
  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'does not reopen %s in the live UI',
    async (status) => {
      h.session.mockResolvedValue({ ...base, status });
      await expect(LivePage({ ...props, searchParams: Promise.resolve({}) })).rejects.toThrow(
        'REDIRECT:/app/patients/client/encounters/session',
      );
    },
  );
  it('redirects active live sessions away from the batch recorder', async () => {
    h.session.mockResolvedValue({ ...base, status: 'IN_PROGRESS', captureMode: 'LIVE' });
    await expect(Workspace(props)).rejects.toThrow(
      'REDIRECT:/app/patients/client/encounters/session/live',
    );
    expect(h.decrypt).not.toHaveBeenCalled();
  });
  it('ignores an upload query on an active dictation session and uses its saved refusal', async () => {
    h.session.mockResolvedValue({
      ...base,
      status: 'IN_PROGRESS',
      captureMode: 'DICTATE',
      consentSnapshot: { ambientCaptureDeclined: true },
    });
    const tree = elements(await Workspace(props));
    expect(tree.find((node) => node.type === 'encounter-panel')?.props).toMatchObject({
      mode: 'dictate',
      liveConsentDeclined: true,
    });
    expect(
      tree.some(
        (node) =>
          typeof node.props.href === 'string' &&
          (node.props.href.includes('/live?') || node.props.href.includes('/teleconsult')),
      ),
    ).toBe(false);
  });
  it('remounts consent checks when switching an unstarted encounter between dictation and upload', async () => {
    const upload = elements(await Workspace(props)).find(
      (node) => node.type === 'encounter-panel',
    )!;
    const dictation = elements(
      await Workspace({ ...props, searchParams: Promise.resolve({ mode: 'dictate' }) }),
    ).find((node) => node.type === 'encounter-panel')!;
    expect(upload.key).not.toBe(dictation.key);
  });
  it('does not disclose a different owner or patient through redirects', async () => {
    h.session.mockResolvedValue({
      ...base,
      psychologistId: 'another-owner',
      status: 'IN_PROGRESS',
      captureMode: 'LIVE',
    });
    await expect(Workspace(props)).rejects.toThrow('NOT_FOUND');
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.decrypt).not.toHaveBeenCalled();
  });
});
