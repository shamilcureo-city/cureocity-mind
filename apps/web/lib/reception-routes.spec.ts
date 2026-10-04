import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  act: vi.fn(),
  publicLoad: vi.fn(),
  consume: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./reception-store', () => ({
  loadReceptionWorkspace: mocks.load,
  saveReceptionSettings: mocks.save,
  actOnReceptionRequest: mocks.act,
  loadPublicReception: mocks.publicLoad,
  consumeReceptionRateLimit: mocks.consume,
  submitReceptionRequest: mocks.submit,
}));
import { GET, PUT } from '../app/api/v1/reception/route';
import { PATCH } from '../app/api/v1/reception/requests/[id]/route';
import { GET as publicGet } from '../app/api/v1/public/reception/[slug]/route';
import { POST } from '../app/api/v1/public/reception/[slug]/requests/route';
import { readReceptionInput } from './reception-server';
import { ReceptionRequestInputSchema } from './reception';

const slug = { params: Promise.resolve({ slug: 'synthetic-practice' }) };
const id = { params: Promise.resolve({ id: 'request-1' }) };
const valid = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  kind: 'QUESTION',
  patientName: 'Synthetic Person',
  patientPhone: '+971501234567',
  message: 'Opening hours?',
  consentContact: true,
};
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://practice.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'owner-1', user: { vertical: 'DOCTOR' } },
  });
  mocks.capability.mockResolvedValue({ ok: true });
  mocks.load.mockResolvedValue({ settings: {} });
  mocks.act.mockResolvedValue({ id: 'request-1', status: 'BOOKED' });
  mocks.submit.mockResolvedValue({ requestId: 'request-1', status: 'NEW' });
  mocks.publicLoad.mockResolvedValue({ slug: 'synthetic-practice', slots: [] });
});

describe('reception HTTP boundaries', () => {
  it('keeps every API closed by default before authentication, storage or rate writes', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'false');
    const replies = await Promise.all([
      GET(request('/api/v1/reception')),
      PUT(request('/api/v1/reception', 'PUT', {})),
      PATCH(request('/api/v1/reception/requests/request-1', 'PATCH', { action: 'DECLINE' }), id),
      publicGet(request('/api/v1/public/reception/synthetic-practice'), slug),
      POST(request('/api/v1/public/reception/synthetic-practice/requests', 'POST', valid), slug),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([503, 503, 503, 503, 503]);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.publicLoad).not.toHaveBeenCalled();
  });

  it('rejects ambient cross-site writes before authentication', async () => {
    const response = await PATCH(
      request(
        '/api/v1/reception/requests/request-1',
        'PATCH',
        { action: 'DECLINE' },
        { cookie: '__session=synthetic', origin: 'https://outside.test' },
      ),
      id,
    );
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.act).not.toHaveBeenCalled();
  });

  it('requires affirmative same-origin public submission even without cookies', async () => {
    expect(
      (
        await POST(
          request('/api/v1/public/reception/synthetic-practice/requests', 'POST', valid),
          slug,
        )
      ).status,
    ).toBe(403);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('accepts a same-origin administrative question with a minimal no-store receipt', async () => {
    const response = await POST(
      request('/api/v1/public/reception/synthetic-practice/requests', 'POST', valid, {
        origin: 'https://practice.test',
        'sec-fetch-site': 'same-origin',
      }),
      slug,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestId: 'request-1', status: 'NEW' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.consume).toHaveBeenCalledBefore(mocks.submit);
  });

  it('requires documentation capability only for approval and never accepts false identity verification', async () => {
    const invalid = await PATCH(
      request('/api/v1/reception/requests/request-1', 'PATCH', {
        action: 'APPROVE_BOOKING',
        clientId: 'client-1',
        identityVerified: false,
      }),
      id,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.act).not.toHaveBeenCalled();
    mocks.capability.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const denied = await PATCH(
      request('/api/v1/reception/requests/request-1', 'PATCH', {
        action: 'APPROVE_BOOKING',
        clientId: 'client-1',
        identityVerified: true,
      }),
      id,
    );
    expect(denied.status).toBe(403);
    expect(mocks.capability.mock.calls[0]?.[1]).toBe('MEDICAL_DOCUMENTATION');
    expect(mocks.act).not.toHaveBeenCalled();
  });

  it('passes only the authenticated owner identifier into mutations', async () => {
    const response = await PATCH(
      request('/api/v1/reception/requests/request-1', 'PATCH', { action: 'DECLINE' }),
      id,
    );
    expect(response.status).toBe(200);
    expect(mocks.act).toHaveBeenCalledWith('owner-1', 'request-1', { action: 'DECLINE' });
  });

  it('rejects unconfirmed erasure and permits explicit owned-request erasure', async () => {
    const denied = await PATCH(
      request('/api/v1/reception/requests/request-1', 'PATCH', {
        action: 'ERASE',
        confirmErase: false,
      }),
      id,
    );
    expect(denied.status).toBe(400);
    mocks.act.mockResolvedValue({ erased: true });
    const response = await PATCH(
      request('/api/v1/reception/requests/request-1', 'PATCH', {
        action: 'ERASE',
        confirmErase: true,
      }),
      id,
    );
    expect(await response.json()).toEqual({ erased: true });
  });

  it('rejects invalid slugs without querying storage', async () => {
    const response = await publicGet(request('/api/v1/public/reception/a'), {
      params: Promise.resolve({ slug: 'a' }),
    });
    expect(response.status).toBe(404);
    expect(mocks.publicLoad).not.toHaveBeenCalled();
  });

  it('bounds actual body bytes without trusting Content-Length', async () => {
    await expect(
      readReceptionInput(
        request('/test', 'POST', { ...valid, message: 'a'.repeat(40_000) }),
        ReceptionRequestInputSchema,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
