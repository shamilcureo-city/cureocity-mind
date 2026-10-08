import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RxPadV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  render: vi.fn(),
  pdf: vi.fn(),
  audit: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: h.session } } }));
vi.mock('./audit', () => ({ writeAudit: h.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./client-pii', () => ({ decryptClientField: h.decrypt }));
vi.mock('@react-pdf/renderer', () => ({ renderToBuffer: h.render }));
vi.mock('../components/pdf/RxPadPdf', () => ({ RxPadPdf: h.pdf }));
import { GET } from '../app/api/v1/sessions/[id]/rx/pdf/route';
const pad = (drug: string) =>
  RxPadV1Schema.parse({ meds: [{ drug, status: 'confirmed', route: 'oral' }] });
const row = () => ({
  id: 's1',
  clientId: 'c1',
  psychologistId: 'p1',
  scheduledAt: new Date('2026-10-01T10:00:00Z'),
  client: { fullNameEncrypted: 'cipher', dateOfBirth: null, deletedAt: null, status: 'ACTIVE' },
  psychologist: { vertical: 'DOCTOR', fullName: 'Fictional doctor' },
  noteDraft: { id: 'd1', rxPad: pad('Draft correction') },
  therapyNote: {
    id: 'n1',
    locked: true,
    rxPad: pad('Signed medicine'),
    signedAt: new Date('2026-10-01T11:00:00Z'),
    signedBy: 'p1',
  },
});
const request = () =>
  GET(new Request('https://example.test/api/v1/sessions/s1/rx/pdf') as never, {
    params: Promise.resolve({ id: 's1' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'p1' } });
  h.session.mockResolvedValue(row());
  h.decrypt.mockResolvedValue('Fictional patient');
  h.render.mockResolvedValue(Buffer.from('fictional bytes'));
});
describe('prescription PDF current signature state', () => {
  it('uses only the attested Rx when currently locked', async () => {
    expect((await request()).status).toBe(200);
    expect(h.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        rx: pad('Signed medicine'),
        signedBy: 'p1',
        signedAt: '2026-10-01T11:00:00.000Z',
      }),
    );
  });
  it('renders a reopened correction as unsigned despite its historical signedAt', async () => {
    h.session.mockResolvedValue({ ...row(), therapyNote: { ...row().therapyNote, locked: false } });
    expect((await request()).status).toBe(200);
    expect(h.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ rx: pad('Draft correction'), signedBy: null, signedAt: null }),
    );
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ signed: false }) }),
    );
  });
  it.each([
    null,
    { ...row(), psychologistId: 'other' },
    { ...row(), client: { ...row().client, deletedAt: new Date() } },
    { ...row(), client: { ...row().client, status: 'INACTIVE' } },
  ])('does not export missing, foreign or unavailable patients', async (value) => {
    h.session.mockResolvedValue(value);
    expect((await request()).status).toBe(404);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
  });
});
