import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  signer: vi.fn(),
  soap: vi.fn(),
  intake: vi.fn(),
  render: vi.fn(),
  audit: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    psychologist: { findUnique: mocks.signer },
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('@/lib/client-pii', () => ({ decryptClientField: mocks.decrypt }));
vi.mock('@react-pdf/renderer', () => ({ renderToBuffer: mocks.render }));
vi.mock('@/components/pdf/IntakeNotePdf', () => ({ IntakeNotePdf: mocks.intake }));
vi.mock('@/components/pdf/SignedNotePdf', () => ({ SignedNotePdf: mocks.soap }));
import { GET } from '../app/api/v1/sessions/[id]/note/pdf/route';
const request = () => new Request('http://localhost/api/v1/sessions/s1/note/pdf') as never;
const ctx = { params: Promise.resolve({ id: 's1' }) };
const row = () => ({
  id: 's1',
  psychologistId: 'p1',
  clientId: 'c1',
  mindDocumentationMode: 'MANUAL',
  kind: 'TREATMENT',
  scheduledAt: new Date('2026-09-10T10:00:00Z'),
  startedAt: null,
  endedAt: null,
  client: { fullNameEncrypted: 'opaque', deletedAt: null },
  therapyNote: {
    id: 'n1',
    locked: true,
    content: { version: 'V1' },
    signedBy: 'p1',
    signedAt: new Date('2026-09-10T11:00:00Z'),
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'p1' } });
  mocks.session.mockResolvedValue(row());
  mocks.decrypt.mockResolvedValue('Fictional client');
  mocks.signer.mockResolvedValue({ fullName: '  Fictional signer  ' });
  mocks.render.mockResolvedValue(Buffer.from('fictional PDF bytes'));
});
describe('signed clinician-note PDF lifecycle', () => {
  it('downloads an explicitly signed manual note without invoking translation or generation', async () => {
    const response = await GET(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it.each(['TREATMENT', 'INTAKE'])(
    'uses only the recorded signer account for %s, not the viewer or query string',
    async (kind) => {
      const current = row();
      current.kind = kind;
      current.therapyNote.signedBy = 'original-signer';
      mocks.session.mockResolvedValue(current);
      const req = new Request(
        'http://localhost/api/v1/sessions/s1/note/pdf?signedByName=Spoofed',
      ) as never;
      expect((await GET(req, ctx)).status).toBe(200);
      expect(mocks.signer).toHaveBeenCalledWith({
        where: { id: 'original-signer' },
        select: { fullName: true },
      });
      const renderer = kind === 'INTAKE' ? mocks.intake : mocks.soap;
      expect(renderer).toHaveBeenCalledWith(
        expect.objectContaining({
          signedBy: 'original-signer',
          signedByName: 'Fictional signer',
        }),
      );
    },
  );
  it.each([null, { fullName: '' }, { fullName: '   ' }])(
    'keeps the stable signer ID when a display name is unavailable',
    async (signer) => {
      mocks.signer.mockResolvedValue(signer);
      expect((await GET(request(), ctx)).status).toBe(200);
      expect(mocks.soap).toHaveBeenCalledWith(
        expect.objectContaining({
          signedBy: 'p1',
          signedByName: null,
        }),
      );
    },
  );
  it('does not describe an unlocked correction as a signed PDF', async () => {
    const current = row();
    current.therapyNote.locked = false;
    mocks.session.mockResolvedValue(current);
    expect((await GET(request(), ctx)).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.signer).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...row(), psychologistId: 'other' },
    { ...row(), client: { fullNameEncrypted: 'opaque', deletedAt: new Date() } },
  ])('hides missing, foreign and erased records before decrypting', async (current) => {
    mocks.session.mockResolvedValue(current);
    expect((await GET(request(), ctx)).status).toBe(404);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.signer).not.toHaveBeenCalled();
  });
});
