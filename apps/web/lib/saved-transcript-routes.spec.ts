import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { encodeSavedTranscript, TRANSCRIPTION_REVIEW_WARNING } from './saved-transcript';
import { TRANSCRIPT_UNAVAILABLE_MESSAGE } from './note-transcript-view';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  draft: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  analyze: vi.fn(),
  aggregate: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.auth,
}));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: mocks.decrypt }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    noteDraft: { findUnique: mocks.draft },
    audioChunk: { aggregate: mocks.aggregate },
    clinicalReport: { findUnique: vi.fn(async () => ({ id: 'report-1' })) },
  },
}));
vi.mock('./note-orchestrator', () => ({ runClinicalAnalysis: mocks.analyze }));
vi.mock('./clinical-mappers', () => ({
  toClinicalReport: () => ({ id: 'report-1' }),
  readInitialAssessmentBrief: () => null,
}));

import { GET } from '../app/api/v1/sessions/[id]/note-draft/route';
import { POST } from '../app/api/v1/sessions/[id]/clinical-analysis/route';

const segments = [
  { speaker: 'client' as const, text: 'Fictional session words.', startMs: 200, endMs: 1400 },
];
let row: Record<string, unknown>;
let session: Record<string, unknown>;
const context = { params: Promise.resolve({ id: 'session-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    id: 'draft-1',
    sessionId: 'session-1',
    status: 'COMPLETED',
    transcriptEncrypted: 'tenant-ciphertext',
    speakerSegments: null,
    affectFeatures: null,
    content: { version: 'V1', subjective: 'Fictional note' },
    riskSeverity: 'NONE',
    totalCostInr: 0,
    errorMessage: TRANSCRIPTION_REVIEW_WARNING,
    createdAt: new Date('2026-09-12T08:00:00Z'),
    updatedAt: new Date('2026-09-12T08:00:00Z'),
    rxPad: null,
  };
  session = {
    id: 'session-1',
    psychologistId: 'psy-1',
    clientId: 'client-1',
    kind: 'TREATMENT',
    modality: 'SUPPORTIVE',
    language: 'en',
    client: { presentingConcerns: null },
    noteDraft: row,
  };
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  mocks.session.mockImplementation(async () => session);
  mocks.draft.mockImplementation(async () => row);
  mocks.decrypt.mockResolvedValue(
    encodeSavedTranscript('Fictional session words.', segments, true),
  );
  mocks.aggregate.mockResolvedValue({ _sum: { durationMs: 1400 } });
});

describe('authenticated saved transcript consumers', () => {
  it('GET exposes decrypted conversation data, not its storage JSON or ciphertext', async () => {
    const response = await GET(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/note-draft'),
      context,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transcript).toBe('Fictional session words.');
    expect(body.speakerSegments).toEqual(segments);
    expect(body.errorMessage).toBe(TRANSCRIPTION_REVIEW_WARNING);
    expect(body).not.toHaveProperty('transcriptEncrypted');
    expect(JSON.stringify(body)).not.toContain('cureocity-transcript-v1');
  });
  it('GET keeps old encrypted transcripts and existing batch segments compatible', async () => {
    mocks.decrypt.mockResolvedValue('Old words.');
    row.speakerSegments = [{ ...segments[0], text: 'Old words.' }];
    const response = await GET(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/note-draft'),
      context,
    );
    const body = await response.json();
    expect(body.transcript).toBe('Old words.');
    expect(body.speakerSegments).toEqual(row.speakerSegments);
  });
  it('GET refuses stale plaintext fallback when the encrypted source cannot be opened', async () => {
    mocks.decrypt.mockResolvedValue(null);
    row.speakerSegments = segments;
    const response = await GET(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/note-draft'),
      context,
    );
    const body = await response.json();
    expect(body.transcript).toBeNull();
    expect(body.speakerSegments).toBeNull();
    expect(body.errorMessage).toBe(TRANSCRIPT_UNAVAILABLE_MESSAGE);
  });
  it('refuses non-owner and denied access before decrypting any source', async () => {
    session.psychologistId = 'other-tenant';
    expect(
      (
        await GET(
          new NextRequest('https://mind.example/api/v1/sessions/session-1/note-draft'),
          context,
        )
      ).status,
    ).toBe(404);
    mocks.auth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect(
      (
        await POST(
          new NextRequest('https://mind.example/api/v1/sessions/session-1/clinical-analysis', {
            method: 'POST',
          }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('clinical analysis receives the decrypted matching timeline without invented speaker coverage', async () => {
    const response = await POST(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/clinical-analysis', {
        method: 'POST',
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: 'Fictional session words.',
        speakerSegments: segments,
      }),
    );
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });
  it('clinical analysis rejects historical placeholder sources before any model call', async () => {
    mocks.decrypt.mockResolvedValue(
      'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).',
    );
    const response = await POST(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/clinical-analysis', {
        method: 'POST',
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('clinical analysis also rejects a legacy artifact present only in the saved speaker timeline', async () => {
    mocks.decrypt.mockResolvedValue('Old transcript words.');
    row.speakerSegments = [
      {
        ...segments[0],
        text: 'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).',
      },
    ];
    const response = await POST(
      new NextRequest('https://mind.example/api/v1/sessions/session-1/clinical-analysis', {
        method: 'POST',
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});
