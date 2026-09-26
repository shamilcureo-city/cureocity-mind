import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  get: vi.fn(),
  manage: vi.fn(),
  publicGet: vi.fn(),
  token: vi.fn(),
  consent: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.capability }));
vi.mock('./scribe-workspace-auth', async (original) => ({
  ...(await original<typeof import('./scribe-workspace-auth')>()),
  requireScribeDoctor: h.auth,
}));
vi.mock('./scribe-teleconsult', () => ({
  getScribeTeleconsultManagement: h.get,
  manageScribeTeleconsult: h.manage,
  getPublicScribeTeleconsult: h.publicGet,
  publicScribeTeleconsultToken: h.token,
  setPublicScribeTeleconsultConsent: h.consent,
}));
import { GET, POST } from '../app/api/v1/scribe/encounters/[sessionId]/teleconsult/route';
import {
  GET as publicGET,
  POST as publicPOST,
} from '../app/api/v1/public/scribe/teleconsult/[id]/route';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
const context = { params: Promise.resolve({ sessionId: 'encounter-a' }) };
const publicContext = { params: Promise.resolve({ id: 'invite-a' }) };
const auth = { ok: true, value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } } };
const req = (body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(
    'https://scribe.example.test/api',
    body === undefined
      ? { headers }
      : {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', ...headers },
        },
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SCRIBE_TELECONSULT_ENABLED', 'true');
  h.auth.mockResolvedValue(auth);
  h.capability.mockResolvedValue(auth);
  h.get.mockResolvedValue({ record: null, configured: true });
  h.manage.mockResolvedValue({ record: null, configured: true });
  h.publicGet.mockResolvedValue({ canJoin: true });
  h.token.mockResolvedValue({ token: 'synthetic' });
  h.consent.mockResolvedValue({ patientConsent: 'declined' });
});
afterEach(() => vi.unstubAllEnvs());
describe('Scribe teleconsult HTTP boundaries', () => {
  it('defaults off on every new endpoint before any account/record lookup', async () => {
    vi.stubEnv('SCRIBE_TELECONSULT_ENABLED', 'false');
    for (const response of [
      await GET(req(), context),
      await POST(req({ action: 'token' }), context),
      await publicGET(req(), publicContext),
      await publicPOST(req({ action: 'token', token: 'a' }), publicContext),
    ])
      expect(response.status).toBe(404);
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.publicGet).not.toHaveBeenCalled();
    expect(h.token).not.toHaveBeenCalled();
  });
  it('does not access a record without doctor authentication', async () => {
    h.auth.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) });
    expect((await GET(req(), context)).status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('requires both medical documentation and live encounter capability on GET and POST', async () => {
    h.capability.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) });
    expect((await GET(req(), context)).status).toBe(403);
    expect((await POST(req({ action: 'token' }), context)).status).toBe(403);
    expect(h.auth).toHaveBeenCalledWith(expect.anything(), 'MEDICAL_DOCUMENTATION');
    expect(h.capability).toHaveBeenCalledWith(expect.anything(), 'LIVE_ENCOUNTER', auth);
    expect(h.manage).not.toHaveBeenCalled();
  });
  it('requires ambient capability for documentation, while video-only tokens do not', async () => {
    h.capability.mockImplementation(async (_req, capability) =>
      capability === 'AMBIENT_CAPTURE'
        ? { ok: false, response: new Response('{}', { status: 403 }) }
        : auth,
    );
    expect(
      (
        await POST(
          req({ action: 'documentation', state: 'preparing', confirmedConsent: true }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(h.manage).not.toHaveBeenCalled();
    expect((await POST(req({ action: 'token' }), context)).status).toBe(200);
  });
  it('uses only the authenticated owner, not a caller-supplied owner or patient', async () => {
    expect(
      (await POST(req({ action: 'create-link', psychologistId: 'other' }), context)).status,
    ).toBe(400);
    expect(h.manage).not.toHaveBeenCalled();
    expect((await POST(req({ action: 'create-link' }), context)).status).toBe(200);
    expect(h.manage).toHaveBeenCalledWith(
      'doctor-a',
      'encounter-a',
      { action: 'create-link' },
      'https://scribe.example.test',
    );
  });
  it('accepts public GET credentials only in Authorization and disables caching', async () => {
    expect((await publicGET(req(), publicContext)).status).toBe(404);
    expect(h.publicGet).not.toHaveBeenCalled();
    const response = await publicGET(
      req(undefined, { authorization: 'Bearer synthetic-link' }),
      publicContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(h.publicGet).toHaveBeenCalledWith('invite-a', 'synthetic-link');
  });
  it('does not treat a video token request as consent', async () => {
    expect((await publicPOST(req({ action: 'token', token: 'link' }), publicContext)).status).toBe(
      200,
    );
    expect(h.token).toHaveBeenCalledWith('invite-a', 'link');
    expect(h.consent).not.toHaveBeenCalled();
    expect(
      (
        await publicPOST(
          req({ action: 'consent', token: 'link', consent: 'declined' }),
          publicContext,
        )
      ).status,
    ).toBe(200);
    expect(h.consent).toHaveBeenCalledWith('invite-a', 'link', 'declined', undefined);
  });
  it('rejects oversized and malformed public input without echoing tokens', async () => {
    const response = await publicPOST(
      req({ action: 'token', token: 'SECRET'.repeat(1500) }),
      publicContext,
    );
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain('SECRET');
    expect(h.token).not.toHaveBeenCalled();
  });
  it('redacts infrastructure errors and preserves explicit safe closed-call errors', async () => {
    h.publicGet.mockRejectedValueOnce(new Error('patient name secret DB password'));
    const response = await publicGET(
      req(undefined, { authorization: 'Bearer link' }),
      publicContext,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('patient name');
    h.token.mockRejectedValueOnce(
      new ScribeWorkspaceError(409, 'This teleconsult is closed or expired.'),
    );
    expect((await publicPOST(req({ action: 'token', token: 'link' }), publicContext)).status).toBe(
      409,
    );
  });
});
