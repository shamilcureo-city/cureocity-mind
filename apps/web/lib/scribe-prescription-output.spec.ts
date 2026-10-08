import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalEncounterNoteV1Schema, RxPadV1Schema } from '@cureocity/contracts';
const h = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: h.session } } }));
vi.mock('@react-pdf/renderer', () => ({
  Document: 'document',
  Page: 'page',
  Text: 'text',
  View: 'view',
  StyleSheet: { create: (value: unknown) => value },
}));
import { buildSnapshot } from './share-snapshots';
import { RxPadPdf } from '../components/pdf/RxPadPdf';
const pad = RxPadV1Schema.parse({
  meds: [
    {
      drug: 'Fictional medicine',
      strength: '5 mg',
      dose: '1 dose',
      frequency: 'daily',
      timing: 'after food',
      route: 'subcutaneous',
      status: 'confirmed',
    },
    { drug: 'Unconfirmed medicine', route: 'oral', status: 'pending' },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  h.session.mockResolvedValue({
    id: 's1',
    clientId: 'c1',
    psychologistId: 'p1',
    scheduledAt: new Date('2026-10-01T10:00:00Z'),
    therapyNote: {
      locked: true,
      rxPad: pad,
      content: MedicalEncounterNoteV1Schema.parse({
        version: 'V1',
        chiefComplaint: 'Fictional concern',
      }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('complete confirmed prescription instructions', () => {
  it.each(['RX_PAD', 'AFTER_VISIT_SUMMARY'] as const)(
    'preserves route and timing in %s patient copies',
    async (artefactType) => {
      const result = await buildSnapshot({
        ref: { artefactType, sessionId: 's1' },
        clientId: 'c1',
        psychologistId: 'p1',
        language: 'en',
      });
      const body = JSON.stringify(result?.snapshot);
      expect(body).toContain('Route: subcutaneous');
      expect(body).toContain('after food');
      expect(body).not.toContain('Unconfirmed medicine');
    },
  );
  it('renders the route and timing on the actual PDF component', () => {
    const tree = RxPadPdf({
      rx: pad,
      clientFullName: 'Fictional patient',
      ageYears: null,
      sessionId: 's1',
      scheduledAt: '2026-10-01T10:00:00Z',
      prescriberName: 'Fictional doctor',
      medicalRegNumber: null,
      rciNumber: null,
      specialty: null,
      clinicName: null,
      signedBy: 'p1',
      signedAt: '2026-10-01T11:00:00Z',
    });
    const body = JSON.stringify(tree);
    expect(body).toContain('Route: subcutaneous');
    expect(body).toContain('after food');
    expect(body).not.toContain('Unconfirmed medicine');
  });
});
