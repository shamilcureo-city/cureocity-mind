import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  requireCapability: vi.fn(),
  runNoteGeneration: vi.fn(),
  runClinicalAnalysis: vi.fn(),
  findSession: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('./note-orchestrator', () => ({
  runNoteGeneration: mocks.runNoteGeneration,
  runClinicalAnalysis: mocks.runClinicalAnalysis,
}));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: mocks.findSession } } }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

import { POST as generateNote } from '../app/api/v1/sessions/[id]/generate-note/route';

const resolved = {
  ok: true as const,
  value: {
    psychologistId: 'psy-1',
    user: { firebaseUid: 'uid', psychologistId: 'psy-1', capabilities: ['MEDICAL_DOCUMENTATION'] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue(resolved);
});

describe('batch note authorization behavior', () => {
  it('returns 403 and does not generate a doctor note without current medical documentation authority', async () => {
    mocks.findSession.mockResolvedValue({
      psychologistId: 'psy-1',
      status: 'COMPLETED',
      psychologist: { vertical: 'DOCTOR' },
    });
    mocks.requireCapability.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'not authorized' }), { status: 403 }),
    });

    const response = await generateNote(
      new Request('https://example.test', { method: 'POST' }) as never,
      {
        params: Promise.resolve({ id: 'session-1' }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      'MEDICAL_DOCUMENTATION',
      resolved,
    );
    expect(mocks.runNoteGeneration).not.toHaveBeenCalled();
  });
});
