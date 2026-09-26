import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), session: vi.fn() }));
vi.mock('./scribe-document-ai', () => ({ generateDocumentJson: mocks.generate }));
vi.mock('./prisma', () => ({ prisma: { session: { findFirst: mocks.session } } }));
vi.mock('./auth-server', () => ({ requireCapability: vi.fn() }));
import { boundedDocumentBody } from './scribe-document-errors';
import { validateReportFile, extractReport } from './scribe-report-processing';
import {
  REPORT_MAX_BYTES,
  ReportReviewInputSchema,
  reportSummary,
  reviewReportCandidates,
} from './scribe-report-schema';
import {
  instructionSourceHash,
  signedInstructionLines,
  draftSignedInstructions,
  readSignedInstructionSource,
  assertInstructionSourceCurrent,
  type SignedInstructionSource,
} from './scribe-instructions-source';
import {
  instructionWordingPreservesFacts,
  reviewedInstructionLines,
} from './scribe-instructions-schema';

const scope = { psychologistId: 'doctor-fictional', clientId: 'patient-fictional' };
const note = (): SignedInstructionSource => ({
  id: 'note-fictional',
  version: 'V1',
  content: { version: 'V1', chiefComplaint: 'Fictional follow-up' },
  signedAt: new Date('2026-09-25T10:00:00Z'),
  signedBy: scope.psychologistId,
  locked: true,
  rxPad: {
    version: 'V1',
    meds: [
      {
        drug: 'Fictional A',
        strength: '5 mg',
        dose: '1 tablet',
        frequency: '1-0-1',
        durationDays: 3,
        status: 'confirmed',
      },
      { drug: 'Unconfirmed B', dose: '2 tablets', status: 'pending' },
    ],
    adviceLines: ['Drink water as advised.'],
    followUp: { when: 'In 3 days', withWhat: 'Bring the original report' },
  },
});
async function pdfFile(pages: number) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  return new File([new Uint8Array(await pdf.save())], 'fictional-report.pdf', {
    type: 'application/pdf',
  });
}
beforeEach(() => vi.clearAllMocks());

describe('bounded lab report upload and candidate review', () => {
  it('parses PDF pages, preserving exact encrypted-store original bytes and a hash', async () => {
    const file = await pdfFile(2);
    const original = await validateReportFile(file);
    expect(original.pages).toBe(2);
    expect(original.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(original.base64, 'base64')).toEqual(Buffer.from(await file.arrayBuffer()));
  });
  it('rejects a sixth PDF page', async () => {
    await expect(validateReportFile(await pdfFile(6))).rejects.toMatchObject({ status: 422 });
  });
  it('rejects active PDF scripts', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(
      PDFName.of('OpenAction'),
      pdf.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('fictional()') }),
    );
    await expect(
      validateReportFile(
        new File([new Uint8Array(await pdf.save())], 'fictional.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('accepts a small actual PNG, not a disguised text payload', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    expect(
      (
        await validateReportFile(
          new File([new Uint8Array(png)], 'fictional.png', { type: 'image/png' }),
        )
      ).pages,
    ).toBe(1);
    await expect(
      validateReportFile(new File(['not an image'], 'fake.png', { type: 'image/png' })),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('rejects MIME spoofing, oversized files and malformed PDFs before model use', async () => {
    await expect(
      validateReportFile(new File(['<svg/>'], 'report.svg', { type: 'image/svg+xml' })),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      validateReportFile(
        new File([new Uint8Array(REPORT_MAX_BYTES + 1)], 'large.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      validateReportFile(new File(['%PDF-invalid'], 'bad.pdf', { type: 'application/pdf' })),
    ).rejects.toMatchObject({ status: 422 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('bounds streamed request bodies without Content-Length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.enqueue(new Uint8Array(11));
        controller.close();
      },
    });
    await expect(
      boundedDocumentBody(
        new Request('https://example.test', {
          method: 'POST',
          body,
          duplex: 'half',
        } as RequestInit),
        20,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('stores only candidates, requires explicit acknowledgments, and preserves evidence through edits', async () => {
    const original = await validateReportFile(await pdfFile(1));
    mocks.generate.mockResolvedValue({
      candidates: [
        {
          name: 'Fictional test',
          value: '12.3',
          unit: 'mg/dL',
          reportDate: '24/09/2026',
          page: 1,
          sourceText: 'Fictional test 12.3 mg/dL',
        },
      ],
    });
    const body = await extractReport(original, scope);
    expect(body.status).toBe('candidate');
    expect(body.reviewedAt).toBeNull();
    expect(reportSummary(body).original).not.toHaveProperty('base64');
    expect(
      ReportReviewInputSchema.safeParse({ revision: 1, candidates: body.candidates }).success,
    ).toBe(false);
    expect(
      reviewReportCandidates(
        body,
        body.candidates.map((row) => ({ ...row, value: '12.4', included: false })),
      ),
    ).toBe(true);
    expect(
      reviewReportCandidates(
        body,
        body.candidates.map((row) => ({ ...row, sourceText: 'invented evidence' })),
      ),
    ).toBe(false);
    expect(reviewReportCandidates(body, [])).toBe(false);
  });
  it('rejects invented page numbers and empty/invalid extraction, not synthetic placeholders', async () => {
    const original = await validateReportFile(await pdfFile(1));
    mocks.generate.mockResolvedValue({
      candidates: [
        { name: 'Test', value: '2', unit: '', reportDate: '', page: 2, sourceText: 'Test 2' },
      ],
    });
    await expect(extractReport(original, scope)).rejects.toMatchObject({ status: 422 });
    mocks.generate.mockResolvedValue({ candidates: [] });
    await expect(extractReport(original, scope)).rejects.toMatchObject({ status: 422 });
  });
});

describe('instructions use only locked signed confirmed content', () => {
  it('rejects swapped schedules and changed units even when number counts are identical', () => {
    const line = signedInstructionLines(note())[0]!;
    expect(instructionWordingPreservesFacts(line, line.text.replace('1-0-1', '0-1-1'))).toBe(false);
    expect(instructionWordingPreservesFacts(line, line.text.replace('5 mg', '5 g'))).toBe(false);
  });
  it('does not include a pending medicine or invent a clock time from dosing shorthand', () => {
    const lines = signedInstructionLines(note());
    expect(lines.some((line) => line.source.includes('Unconfirmed B'))).toBe(false);
    expect(lines[0]?.source).toContain('Schedule: 1-0-1');
    expect(lines[0]?.source).not.toContain('08:00');
    expect(lines.some((line) => line.kind === 'followup' && line.source.includes('3 days'))).toBe(
      true,
    );
  });
  it('refuses unlocked notes, absent signed Rx and invalid source', () => {
    expect(() => signedInstructionLines({ ...note(), locked: false })).toThrow();
    expect(() => signedInstructionLines({ ...note(), rxPad: null })).toThrow();
    expect(() => signedInstructionLines({ ...note(), signedAt: new Date('invalid') })).toThrow();
  });
  it('binds the exact note, Rx, identity and signature timestamp', () => {
    const source = note();
    const hash = instructionSourceHash(source);
    expect(
      instructionSourceHash({
        ...source,
        content: { ...(source.content as object), plan: 'changed' },
      }),
    ).not.toBe(hash);
    expect(
      instructionSourceHash({
        ...source,
        rxPad: { ...(source.rxPad as object), adviceLines: ['changed'] },
      }),
    ).not.toBe(hash);
    expect(
      instructionSourceHash({ ...source, signedAt: new Date(source.signedAt.getTime() + 1) }),
    ).not.toBe(hash);
  });
  it('produces an unreviewed source draft without any model use', async () => {
    const body = await draftSignedInstructions(note(), 'source', scope);
    expect(body.status).toBe('draft');
    expect(body.clinicalReviewed).toBe(false);
    expect(body.languageReviewed).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('fails closed if translation alters a number or adds a medication row', async () => {
    const lines = signedInstructionLines(note()).filter((line) => line.kind !== 'medication');
    mocks.generate.mockResolvedValue({
      lines: lines.map(({ id, source }) => ({ id, text: source.replace('3 days', '30 days') })),
    });
    await expect(draftSignedInstructions(note(), 'ml', scope)).rejects.toMatchObject({
      status: 422,
    });
    mocks.generate.mockResolvedValue({
      lines: [
        ...lines.map(({ id, source }) => ({ id, text: source })),
        { id: 'medication-1', text: 'Added medication' },
      ],
    });
    await expect(draftSignedInstructions(note(), 'hi', scope)).rejects.toMatchObject({
      status: 422,
    });
  });
  it('retains immutable source alongside translation and rejects numeric edits/missing source rows', async () => {
    const lines = signedInstructionLines(note());
    mocks.generate.mockResolvedValue({
      lines: lines
        .filter((line) => line.kind !== 'medication')
        .map(({ id, source }) => ({ id, text: `Reviewed translation: ${source}` })),
    });
    const body = await draftSignedInstructions(note(), 'ml', scope);
    expect(body.lines[0]?.source).toBe(lines[0]?.source);
    expect(body.lines[0]?.text).toBe(lines[0]?.source);
    expect(JSON.stringify(mocks.generate.mock.calls[0]?.[1])).not.toContain('Fictional A');
    expect(body.languageReviewed).toBe(false);
    expect(
      reviewedInstructionLines(
        body,
        body.lines.map(({ id, text }) => ({ id, text })),
      ),
    ).toHaveLength(lines.length);
    expect(reviewedInstructionLines(body, body.lines.slice(1))).toBeNull();
    expect(
      reviewedInstructionLines(
        body,
        body.lines.map(({ id, text }) => ({ id, text: text.replace('5 mg', '10 mg') })),
      ),
    ).toBeNull();
  });
  it.each([
    ['OD', 'BD'],
    ['before food', 'after food'],
    ['oral', 'topical'],
  ])('keeps non-numeric medication fact %s immutable', (before, after) => {
    const source = `Fictional A · ${before}`;
    const line = { id: 'medication-1', kind: 'medication' as const, source, text: source };
    expect(instructionWordingPreservesFacts(line, source.replace(before, after))).toBe(false);
  });
  it('checks tenant/active patient ownership and refuses stale source after resigning', async () => {
    mocks.session.mockResolvedValue({ clientId: scope.clientId, therapyNote: note() });
    const source = await readSignedInstructionSource(scope.psychologistId, 'session-fictional');
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          psychologistId: scope.psychologistId,
          psychologist: expect.objectContaining({ vertical: 'DOCTOR' }),
          client: expect.objectContaining({ deletedAt: null }),
        }),
      }),
    );
    mocks.session.mockResolvedValue({
      clientId: scope.clientId,
      therapyNote: { ...note(), locked: false },
    });
    await expect(
      assertInstructionSourceCurrent(
        scope.psychologistId,
        'session-fictional',
        scope.clientId,
        source.sourceHash,
      ),
    ).rejects.toMatchObject({ status: 409 });
    mocks.session.mockResolvedValue({
      clientId: scope.clientId,
      therapyNote: { ...note(), signedAt: new Date('2026-09-25T11:00:00Z') },
    });
    await expect(
      assertInstructionSourceCurrent(
        scope.psychologistId,
        'session-fictional',
        scope.clientId,
        source.sourceHash,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
