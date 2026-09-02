import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  parseJson: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./share-channels', () => ({ shareChannels: vi.fn() }));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: vi.fn(),
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({ resolveClientPii: vi.fn() }));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./sprint5-final-behavior', () => ({ recoverExpiredDispatch: vi.fn() }));

import { POST as share } from '../app/api/v1/share/route';
import { POST as resend } from '../app/api/v1/shares/[id]/resend/route';
import { POST as revoke } from '../app/api/v1/shares/[id]/revoke/route';
import { POST as issueClaim } from '../app/api/v1/clients/[id]/claim-token/route';
import { GET as prepare } from '../app/api/v1/clients/[id]/prepare/route';
import { GET as mindShareOptions } from '../app/api/v1/sessions/[id]/mind-share-options/route';
import { PUT as patientTakeaway } from '../app/api/v1/sessions/[id]/patient-takeaway/route';

function request(path: string) {
  return new Request(`https://example.test${path}`, { method: 'POST', body: '{}' });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}

describe('regulated sharing route response privacy', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['share', (req: Request) => share(req as never)],
    [
      'resend',
      (req: Request) => resend(req as never, { params: Promise.resolve({ id: 'share-1' }) }),
    ],
    [
      'revoke',
      (req: Request) => revoke(req as never, { params: Promise.resolve({ id: 'share-1' }) }),
    ],
    [
      'claim-token issuance',
      (req: Request) => issueClaim(req as never, { params: Promise.resolve({ id: 'client-1' }) }),
    ],
    [
      'prepare',
      (req: Request) => prepare(req as never, { params: Promise.resolve({ id: 'client-1' }) }),
    ],
    [
      'mind share options',
      (req: Request) =>
        mindShareOptions(req as never, { params: Promise.resolve({ id: 'session-1' }) }),
    ],
    [
      'patient takeaway',
      (req: Request) =>
        patientTakeaway(req as never, { params: Promise.resolve({ id: 'session-1' }) }),
    ],
  ])('wraps %s authentication failures as private no-store/no-referrer', async (_name, call) => {
    mocks.requireCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await call(request('/api/v1/test'));

    expect(response.status).toBe(401);
    expectPrivate(response);
  });

  it('wraps share JSON parse failures as private no-store/no-referrer', async () => {
    mocks.requireCapability.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
    });
    mocks.parseJson.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
    });

    const response = await share(request('/api/v1/share') as never);

    expect(response.status).toBe(400);
    expectPrivate(response);
  });
});
