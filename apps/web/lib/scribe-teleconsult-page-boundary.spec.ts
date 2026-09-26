import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  doctor: vi.fn(),
  capabilities: vi.fn(),
  enabled: vi.fn(),
  session: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('SAFE_NOT_FOUND');
  },
}));
vi.mock('./auth-page', () => ({ requireOnboardedDoctor: h.doctor }));
vi.mock('./capabilities', () => ({ getEffectiveCapabilities: h.capabilities }));
vi.mock('./scribe-teleconsult-links', () => ({ isScribeTeleconsultEnabled: h.enabled }));
vi.mock('./prisma', () => ({ prisma: { session: { findFirst: h.session } } }));
vi.mock('./client-pii', () => ({ decryptClientField: h.decrypt }));
vi.mock('../components/app/ScribeTeleconsultShell', () => ({
  ScribeTeleconsultShell: 'teleconsult-shell',
}));
import Page from '../app/app/patients/[id]/encounters/[sessionId]/teleconsult/page';

type Props = {
  children?: ReactNode;
  sessionId?: string;
  clientId?: string;
  patient?: { name: string; age: number | null };
  sessionClosed?: boolean;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
const doctor = { id: 'doctor-1', status: 'ACTIVE', deletedAt: null, specialty: 'General practice' };
function render() {
  return Page({ params: Promise.resolve({ id: 'patient-1', sessionId: 'session-1' }) });
}
function expectNoDisclosure() {
  expect(h.session).not.toHaveBeenCalled();
  expect(h.decrypt).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  h.doctor.mockResolvedValue(doctor);
  h.enabled.mockReturnValue(true);
  h.capabilities.mockResolvedValue({
    capabilities: new Set(['MEDICAL_DOCUMENTATION', 'LIVE_ENCOUNTER']),
  });
  h.session.mockResolvedValue({
    status: 'IN_PROGRESS',
    client: {
      fullNameEncrypted: 'fictional-ciphertext',
      dateOfBirth: new Date('2000-01-01T00:00:00Z'),
    },
  });
  h.decrypt.mockResolvedValue('Fictional patient');
});
afterEach(() => vi.unstubAllGlobals());

describe('Scribe teleconsult server-page disclosure boundary', () => {
  it('does not access patient details when the onboarding/doctor identity guard denies entry', async () => {
    h.doctor.mockRejectedValue(new Error('REDIRECT_LOGIN_OR_VERTICAL'));
    await expect(render()).rejects.toThrow('REDIRECT_LOGIN_OR_VERTICAL');
    expect(h.capabilities).not.toHaveBeenCalled();
    expectNoDisclosure();
  });

  it('retains the disabled feature boundary before current-authority and patient lookups', async () => {
    h.enabled.mockReturnValue(false);
    await expect(render()).rejects.toThrow('SAFE_NOT_FOUND');
    expect(h.capabilities).not.toHaveBeenCalled();
    expectNoDisclosure();
  });

  it.each([
    ['suspended', { ...doctor, status: 'SUSPENDED' }],
    ['offboarded', { ...doctor, status: 'OFFBOARDED' }],
    ['pending verification', { ...doctor, status: 'PENDING_VERIFICATION' }],
    ['erased', { ...doctor, deletedAt: new Date('2026-09-01') }],
  ])(
    'denies a %s doctor snapshot before resolving or decrypting patient records',
    async (_label, value) => {
      h.doctor.mockResolvedValue(value);
      await expect(render()).rejects.toThrow('SAFE_NOT_FOUND');
      expect(h.capabilities).not.toHaveBeenCalled();
      expectNoDisclosure();
    },
  );

  it.each([
    { capabilities: [] },
    { capabilities: ['MEDICAL_DOCUMENTATION'] },
    { capabilities: ['LIVE_ENCOUNTER'] },
    { capabilities: ['BEHAVIORAL_HEALTH_DOCUMENTATION', 'LIVE_ENCOUNTER'] },
  ])('requires both current medical and live capabilities: %j', async ({ capabilities }) => {
    h.capabilities.mockResolvedValue({ capabilities: new Set(capabilities) });
    await expect(render()).rejects.toThrow('SAFE_NOT_FOUND');
    expect(h.capabilities).toHaveBeenCalledExactlyOnceWith('doctor-1');
    expectNoDisclosure();
  });

  it.each(['Practitioner is not active', 'Capability lookup unavailable: internal-secret'])(
    'fails closed without disclosing authority-lookup errors (%s)',
    async (reason) => {
      h.capabilities.mockRejectedValue(new Error(reason));
      await expect(render()).rejects.toThrow(/^SAFE_NOT_FOUND$/);
      expectNoDisclosure();
    },
  );

  it('authorizes before the owner/client/session scoped query and patient decryption', async () => {
    const tree = await render();
    expect(h.session).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'session-1',
        clientId: 'patient-1',
        psychologistId: 'doctor-1',
        client: { deletedAt: null, status: 'ACTIVE', psychologistId: 'doctor-1' },
      },
      select: { status: true, client: { select: { fullNameEncrypted: true, dateOfBirth: true } } },
    });
    expect(h.capabilities.mock.invocationCallOrder[0]).toBeLessThan(
      h.session.mock.invocationCallOrder[0]!,
    );
    expect(h.session.mock.invocationCallOrder[0]).toBeLessThan(
      h.decrypt.mock.invocationCallOrder[0]!,
    );
    expect(h.decrypt).toHaveBeenCalledExactlyOnceWith('doctor-1', 'fictional-ciphertext');
    expect(text(tree)).toContain('Fictional patient');
    const shell = elements(tree).find((item) => item.type === 'teleconsult-shell')!;
    expect(shell.props).toMatchObject({
      sessionId: 'session-1',
      clientId: 'patient-1',
      sessionClosed: false,
      patient: { name: 'Fictional patient', age: expect.any(Number) },
    });
  });

  it('does not decrypt when the active owned encounter lookup returns no match', async () => {
    h.session.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('SAFE_NOT_FOUND');
    expect(h.decrypt).not.toHaveBeenCalled();
  });

  it('preserves completed-session call display with capture marked closed', async () => {
    h.session.mockResolvedValue({
      status: 'COMPLETED',
      client: { fullNameEncrypted: 'fictional-ciphertext', dateOfBirth: null },
    });
    const tree = await render();
    const shell = elements(tree).find((item) => item.type === 'teleconsult-shell')!;
    expect(shell.props).toMatchObject({
      sessionClosed: true,
      patient: { name: 'Fictional patient', age: null },
    });
  });

  it('keeps other closed lifecycle states out of the call shell', async () => {
    h.session.mockResolvedValue({
      status: 'NO_SHOW',
      client: { fullNameEncrypted: 'fictional-ciphertext', dateOfBirth: null },
    });
    const tree = await render();
    expect(elements(tree).some((item) => item.type === 'teleconsult-shell')).toBe(false);
    expect(text(tree)).toContain('no longer open for video capture');
  });
});
