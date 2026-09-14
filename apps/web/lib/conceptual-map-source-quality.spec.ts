import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  sessions: vi.fn(),
  diagnosis: vi.fn(),
  transcript: vi.fn(),
  name: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: mocks.client },
    session: { findMany: mocks.sessions },
    clientDiagnosis: { findFirst: mocks.diagnosis },
  },
}));
vi.mock('./note-transcript', () => ({ resolveNoteTranscriptData: mocks.transcript }));
vi.mock('./client-pii', () => ({ decryptClientField: mocks.name }));
import { buildConceptualMapContext } from './conceptual-map';

const marker = 'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';
const cleanText = 'എനിക്ക് anxiety undu. Sharafath helped with the placeholder in my document.';
const session = () => ({
  id: 'fictional-session',
  kind: 'TREATMENT',
  endedAt: new Date('2026-09-12T08:00:00Z'),
  noteDraft: { transcriptEncrypted: 'fictional-ciphertext' },
  therapyNote: {
    content: { subjective: 'Fictional reviewed account', assessment: 'Fictional assessment' },
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({
    fullNameEncrypted: 'fictional-name',
    presentingConcerns: null,
    preferredModality: null,
  });
  mocks.name.mockResolvedValue('Fictional client');
  mocks.sessions.mockResolvedValue([session()]);
  mocks.diagnosis.mockResolvedValue(null);
  mocks.transcript.mockResolvedValue({
    transcript: cleanText,
    speakerSegments: null,
    transcriptionWarning: false,
  });
});

describe('conceptual map source quality', () => {
  it('preserves legitimate multilingual history and tenant filtering', async () => {
    const result = await buildConceptualMapContext('client-1', 'psy-1');
    expect(result.sessionIds).toEqual(['fictional-session']);
    expect(result.text).toContain(cleanText);
    expect(result.text).toContain('Fictional reviewed account');
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'client-1', psychologistId: 'psy-1', deletedAt: null },
      }),
    );
  });

  it('rejects full transcript artifacts even when truncation would have hidden the marker', async () => {
    mocks.transcript.mockResolvedValue({
      transcript: `${'before '.repeat(1200)}${marker}${' after'.repeat(1200)}`,
      speakerSegments: null,
    });
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'source needs review',
    );
  });

  it('rejects note artifacts outside the SOAP summary instead of dropping them', async () => {
    const row = session();
    mocks.sessions.mockResolvedValue([
      {
        ...row,
        therapyNote: {
          content: { ...row.therapyNote.content, linkedEvidence: [{ quote: marker }] },
        },
      },
    ]);
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'source needs review',
    );
  });

  it('checks a contaminated note even when its transcript is empty', async () => {
    mocks.transcript.mockResolvedValue({ transcript: '', speakerSegments: [] });
    mocks.sessions.mockResolvedValue([
      { ...session(), therapyNote: { content: { subjective: marker } } },
    ]);
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'source needs review',
    );
  });

  it('rejects artifacts in the encrypted speaker timeline', async () => {
    mocks.transcript.mockResolvedValue({
      transcript: cleanText,
      speakerSegments: [{ text: marker }],
    });
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'source needs review',
    );
  });

  it('does not silently omit an unreadable encrypted session', async () => {
    mocks.transcript.mockResolvedValue(null);
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'saved transcript could not be read',
    );
  });

  it('rejects before returning any partial history when another visit is contaminated', async () => {
    mocks.sessions.mockResolvedValue([
      { ...session(), id: 'newer' },
      { ...session(), id: 'older' },
    ]);
    mocks.transcript
      .mockResolvedValueOnce({ transcript: cleanText, speakerSegments: null })
      .mockResolvedValueOnce({ transcript: marker, speakerSegments: null });
    await expect(buildConceptualMapContext('client-1', 'psy-1')).rejects.toThrow(
      'source needs review',
    );
  });

  it('does not read another tenant client history', async () => {
    mocks.client.mockResolvedValue(null);
    await expect(buildConceptualMapContext('client-1', 'wrong-psy')).rejects.toThrow(
      'Client not found',
    );
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.transcript).not.toHaveBeenCalled();
  });
});
