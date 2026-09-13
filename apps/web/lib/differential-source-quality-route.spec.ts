import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  transcript: vi.fn(),
  run: vi.fn(),
  differential: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    differential: { findUnique: mocks.differential },
  },
}));
vi.mock('./note-transcript', () => ({
  hasTranscript: (row: { transcriptEncrypted?: string }) => Boolean(row.transcriptEncrypted),
  resolveNoteTranscriptData: mocks.transcript,
}));
vi.mock('./note-orchestrator', () => ({ runDifferential: mocks.run }));
import { POST } from '../app/api/v1/sessions/[id]/differential/route';

const marker =
  'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the provided audio input.';
const cleanText = 'എനിക്ക് anxiety undu. Sharafath helped with the placeholder.';
const row = () => ({
  id: 'fictional-session',
  psychologistId: 'psy-1',
  language: 'en',
  psychologist: { specialty: null },
  noteDraft: {
    status: 'COMPLETED',
    transcriptEncrypted: 'fictional-ciphertext',
    speakerSegments: null,
    content: { version: 'V1', chiefComplaint: 'Fictional spoken concern' },
  },
});
const send = () =>
  POST(
    new NextRequest('http://localhost/api/v1/sessions/fictional-session/differential', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'fictional-session' }) },
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.session.mockResolvedValue(row());
  mocks.transcript.mockResolvedValue({
    transcript: cleanText,
    speakerSegments: null,
    transcriptionWarning: false,
  });
  mocks.run.mockResolvedValue(undefined);
  mocks.differential.mockResolvedValue({ status: 'COMPLETED', body: null, errorMessage: null });
});

describe('doctor differential saved-source guard', () => {
  it.each(['transcript', 'segment', 'note'] as const)(
    'rejects contaminated %s before a model call',
    async (field) => {
      if (field === 'transcript')
        mocks.transcript.mockResolvedValue({ transcript: marker, speakerSegments: null });
      if (field === 'segment')
        mocks.transcript.mockResolvedValue({
          transcript: cleanText,
          speakerSegments: [{ speaker: 'client', startMs: 0, endMs: 1000, text: marker }],
        });
      if (field === 'note') {
        const value = row();
        value.noteDraft.content.chiefComplaint = marker;
        mocks.session.mockResolvedValue(value);
      }
      const response = await send();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'TRANSCRIPT_NEEDS_REVIEW' });
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.differential).not.toHaveBeenCalled();
    },
  );

  it('also checks legacy plaintext speaker segments', async () => {
    const value = row();
    mocks.session.mockResolvedValue({
      ...value,
      noteDraft: {
        ...value.noteDraft,
        speakerSegments: [{ speaker: 'unknown', startMs: 0, endMs: 1000, text: marker }],
      },
    });
    expect((await send()).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('fails closed when ciphertext cannot be read', async () => {
    mocks.transcript.mockResolvedValue(null);
    expect((await send()).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('preserves clean text and uses the encrypted speaker timeline', async () => {
    const segments = [{ speaker: 'client', startMs: 0, endMs: 1000, text: cleanText }];
    mocks.transcript.mockResolvedValue({
      transcript: cleanText,
      speakerSegments: segments,
      transcriptionWarning: false,
    });
    expect((await send()).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: cleanText, speakerSegments: segments }),
    );
  });

  it('rejects another tenant before decrypting its transcript', async () => {
    mocks.session.mockResolvedValue({ ...row(), psychologistId: 'other-psy' });
    expect((await send()).status).toBe(404);
    expect(mocks.transcript).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
