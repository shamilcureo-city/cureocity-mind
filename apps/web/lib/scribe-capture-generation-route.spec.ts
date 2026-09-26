import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preserveScribeCaptureIntegrity } from './scribe-capture-integrity';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  session: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: mocks.session } } }));
vi.mock('./note-orchestrator', () => ({
  runNoteGeneration: mocks.generate,
  runClinicalAnalysis: vi.fn(),
}));
import { POST } from '../app/api/v1/sessions/[id]/generate-note/route';

beforeEach(() => {
  vi.resetAllMocks();
  const auth = { ok: true, value: { psychologistId: 'psy-1', user: { capabilities: [] } } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.generate.mockResolvedValue({ draftId: 'draft-1', status: 'COMPLETED' });
});

describe('Scribe incomplete capture regeneration boundary', () => {
  it.each([true, false])(
    'does not let regeneration erase an incomplete capture marker (%s)',
    async (incomplete) => {
      mocks.session.mockResolvedValue({
        psychologistId: 'psy-1',
        status: 'COMPLETED',
        mindDocumentationMode: null,
        psychologist: { vertical: 'DOCTOR' },
        noteDraft: {
          errorMessage: preserveScribeCaptureIntegrity(
            null,
            incomplete,
            incomplete ? 'connection_lost' : undefined,
          ),
        },
      });
      const response = await POST(
        new Request('https://example.test/generate-note', { method: 'POST' }) as never,
        { params: Promise.resolve({ id: 'session-1' }) },
      );
      expect(response.status).toBe(incomplete ? 409 : 200);
      expect(mocks.generate).toHaveBeenCalledTimes(incomplete ? 0 : 1);
    },
  );
});
