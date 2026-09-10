import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: mocks.session } } }));
import { enforceManualSessionBoundary, manualBoundarySessionId } from './mind-manual-boundary';
const req = (path: string, method = 'POST') =>
  new Request(`https://mind.test/api/v1/${path}`, { method }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    psychologistId: 'owner',
    mindDocumentationMode: 'MANUAL',
    client: { deletedAt: null },
  });
});
describe('clinician-written session authority', () => {
  it.each([
    'start',
    'end',
    'live-token',
    'live-note',
    'live-suggestion',
    'live-metric',
    'consent-recovery',
    'capture-resume',
    'recovery-transcript',
    'generate-note',
    'clinical-analysis',
    'differential',
    'note/modify',
    'plan-dictation',
  ])('denies %s before model/capture work', async (operation) => {
    const response = await enforceManualSessionBoundary(
      req(`sessions/visit/${operation}`),
      'owner',
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ code: 'MIND_MANUAL_SESSION' });
  });
  it.each([
    'sign',
    'note/unlock',
    'manual-note',
    'agreements',
    'mind-closeout',
    'patient-takeaway',
    'note/review',
  ])('does not deny clinician-authored %s on a clinical capability alone', async (operation) => {
    expect(
      await enforceManualSessionBoundary(req(`sessions/visit/${operation}`), 'owner'),
    ).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    ['note-draft', 'PUT'],
    ['note/edit', 'POST'],
    ['note-edit-recovery', 'PUT'],
    ['note-edit-recovery', 'DELETE'],
  ])('requires the authoritative manual editor instead of %s %s', async (operation, method) => {
    const response = await enforceManualSessionBoundary(
      req(`sessions/visit/${operation}`, method),
      'owner',
    );
    expect(response?.status).toBe(409);
    expect((await response!.json()).error).toContain('Use the clinician-written workspace');
  });
  it('keeps read-only clinical review available and covers Encounter aliases', () => {
    expect(manualBoundarySessionId(req('sessions/visit/clinical-analysis', 'GET'))).toBeNull();
    expect(manualBoundarySessionId(req('encounters/visit/start'))).toBe('visit');
    expect(manualBoundarySessionId(req('encounters/visit/complete'))).toBe('visit');
  });
  it('checks direct upload before its audio body is consumed', async () => {
    const request = new Request('https://mind.test/api/v1/audio/chunks/upload', {
      method: 'POST',
      headers: { 'x-session-id': 'visit' },
      body: 'fictional audio',
    });
    expect((await enforceManualSessionBoundary(request as never, 'owner'))?.status).toBe(409);
    expect(request.bodyUsed).toBe(false);
  });
  it.each([
    null,
    { psychologistId: 'other', mindDocumentationMode: 'MANUAL', client: { deletedAt: null } },
    { psychologistId: 'owner', client: { deletedAt: new Date() } },
  ])('hides absent, foreign and erased records', async (row) => {
    mocks.session.mockResolvedValue(row);
    expect((await enforceManualSessionBoundary(req('sessions/visit/start'), 'owner'))?.status).toBe(
      404,
    );
  });
  it('preserves legacy recording sessions', async () => {
    mocks.session.mockResolvedValue({
      psychologistId: 'owner',
      mindDocumentationMode: null,
      client: { deletedAt: null },
    });
    expect(await enforceManualSessionBoundary(req('sessions/visit/start'), 'owner')).toBeNull();
  });
});
