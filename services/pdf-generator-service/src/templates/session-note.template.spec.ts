import { describe, it, expect } from 'vitest';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { renderSessionNoteHtml } from './session-note.template';

const baseNote: TherapyNoteV1 = {
  version: 'V1',
  modality: 'CBT',
  subjective: 'Client reports better sleep this week.',
  objective: 'Engaged, oriented, euthymic affect.',
  assessment: 'Improving response to cognitive restructuring.',
  plan: 'Continue thought records; introduce graded exposure.',
  riskFlags: { severity: 'none', indicators: [] },
  phaseHints: [{ phase: 'behavioral_activation', confidence: 0.7, rationale: 'goals met' }],
  linkedEvidence: [],
};

describe('renderSessionNoteHtml', () => {
  it('renders an HTML doc with the EN canonical labels', () => {
    const html = renderSessionNoteHtml({
      note: baseNote,
      clientFullName: 'Arjun Rao',
      sessionId: 'sess_1',
      modality: 'CBT',
      scheduledAt: '2026-06-01',
      durationMs: 50 * 60_000,
      signedBy: 'Dr. Priya Menon',
      signedAt: '2026-06-01T15:00:00Z',
      locale: 'en',
    });
    expect(html).toContain('<title>Therapy Session Note</title>');
    expect(html).toContain('Subjective');
    expect(html).toContain('Arjun Rao');
    expect(html).toContain('Dr. Priya Menon');
    expect(html).toContain('50 min');
  });

  it('escapes user-supplied strings (no markup injection)', () => {
    const html = renderSessionNoteHtml({
      note: { ...baseNote, subjective: 'Client said "<script>alert(1)</script>"' },
      clientFullName: 'Arjun & Co.',
      sessionId: 'sess_1',
      modality: 'CBT',
      scheduledAt: '2026-06-01',
      durationMs: null,
      signedBy: null,
      signedAt: null,
      locale: 'en',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Arjun &amp; Co.');
  });

  it('applies risk-{severity} CSS class', () => {
    const html = renderSessionNoteHtml({
      note: { ...baseNote, riskFlags: { severity: 'high', indicators: ['suicidal ideation'] } },
      clientFullName: 'x',
      sessionId: 'x',
      modality: 'CBT',
      scheduledAt: '2026-06-01',
      durationMs: null,
      signedBy: null,
      signedAt: null,
      locale: 'en',
    });
    expect(html).toContain('risk-high');
    expect(html).toContain('HIGH');
    expect(html).toContain('suicidal ideation');
  });

  it('uses Hindi strings when locale=hi', () => {
    const html = renderSessionNoteHtml({
      note: baseNote,
      clientFullName: 'Arjun Rao',
      sessionId: 'sess_1',
      modality: 'CBT',
      scheduledAt: '2026-06-01',
      durationMs: null,
      signedBy: null,
      signedAt: null,
      locale: 'hi',
    });
    expect(html).toContain('थेरेपी सत्र नोट');
  });

  it('uses Malayalam strings when locale=ml', () => {
    const html = renderSessionNoteHtml({
      note: baseNote,
      clientFullName: 'Arjun Rao',
      sessionId: 'sess_1',
      modality: 'CBT',
      scheduledAt: '2026-06-01',
      durationMs: null,
      signedBy: null,
      signedAt: null,
      locale: 'ml',
    });
    expect(html).toContain('തെറാപ്പി സെഷൻ കുറിപ്പ്');
  });
});
