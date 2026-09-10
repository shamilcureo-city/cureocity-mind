import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { canonicalMindManualNote, MindManualNoteFieldsSchema } from '@cureocity/contracts';
import type { IntakeNoteV1, TherapyNoteV1 } from '@cureocity/contracts';
import { SignedNotePdf } from '../components/pdf/SignedNotePdf';
import { IntakeNotePdf } from '../components/pdf/IntakeNotePdf';

const fields = MindManualNoteFieldsSchema.parse({
  presentingConcerns: 'Fictional presenting concern.',
  historyOfPresentingIllness: 'Fictional history discussed.',
  pastPsychiatricHistory: 'Fictional history not yet explored.',
  familyHistory: 'Fictional family context not yet explored.',
  socialHistory: 'Fictional social context discussed.',
  mentalStatusExam: 'Fictional observations documented.',
  workingHypothesis: 'Fictional provisional understanding; no diagnosis assigned.',
  immediatePlan: 'Fictional plan agreed together.',
  subjective: 'Fictional client account.',
  objective: 'Fictional observations.',
  assessment: 'Fictional provisional understanding.',
  plan: 'Fictional shared next step.',
  riskSeverity: 'none',
  riskDetails: 'Fictional safety assessment only.',
});
const common = {
  clientFullName: 'Fictional client',
  sessionId: 'fictional-session',
  scheduledAt: '2026-09-10T10:00:00.000Z',
  durationMs: null,
  signedBy: 'recorded-signer-id',
  signedAt: '2026-09-10T11:00:00.000Z',
};
const layouts = [
  {
    name: 'SOAP',
    render: (signedByName: string | null, signed = true) =>
      SignedNotePdf({
        ...common,
        signedBy: signed ? common.signedBy : null,
        signedByName,
        note: canonicalMindManualNote('TREATMENT', 'SUPPORTIVE', fields) as TherapyNoteV1,
      }),
  },
  {
    name: 'intake',
    render: (signedByName: string | null, signed = true) =>
      IntakeNotePdf({
        ...common,
        signedBy: signed ? common.signedBy : null,
        signedByName,
        note: canonicalMindManualNote('INTAKE', null, fields) as IntakeNoteV1,
      }),
  },
];

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

describe.each(layouts)('$name signed PDF clinician identity', ({ render }) => {
  it('renders the human name, separate stable ID and current-account provenance into a valid PDF', async () => {
    const document = render('  Fictional Clinician  ');
    const text = textOf(document);
    expect(text).toContain('Signed by Fictional Clinician on ');
    expect(text).toContain('Clinician ID: recorded-signer-id');
    expect(text).toContain('Name from current account');
    expect(text).not.toContain('Signed by recorded-signer-id');
    expect(document.props.author).toBe('Fictional Clinician');
    const pdf = await renderToBuffer(document);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-8).toString()).toContain('%%EOF');
  });

  it.each([null, '', '   '])(
    'retains traceability without inventing a missing signer name: %s',
    (name) => {
      const document = render(name);
      const text = textOf(document);
      expect(text).toContain('Signed by Clinician name unavailable on ');
      expect(text).toContain('Clinician ID: recorded-signer-id');
      expect(text).not.toContain('Name from current account');
      expect(document.props.author).toBe('Cureocity Mind');
    },
  );

  it('does not turn an unsigned note into a signed note from a display name alone', () => {
    const text = textOf(render('Fictional Clinician', false));
    expect(text).toContain('Unsigned draft');
    expect(text).not.toContain('Signed by');
    expect(text).not.toContain('Clinician ID:');
  });
});
