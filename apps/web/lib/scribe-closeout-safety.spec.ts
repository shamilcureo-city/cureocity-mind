import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Scribe evidence-first closeout safety', () => {
  it('requires an explicit live-capture consent choice and exposes dictation fallback', () => {
    const flow = source('components/app/LiveEncounterFlow.tsx');
    const consentRoute = source('app/api/v1/sessions/[id]/consent/route.ts');

    expect(flow).toContain('Save consent and open live consult');
    expect(flow).toContain("method: 'POST'");
    expect(flow).toContain('Patient declined — use dictation');
    expect(flow).toContain('liveConsent=declined');
    expect(flow).toContain("method: 'DELETE'");
    expect(flow).toContain('autoStart={false}');
    expect(consentRoute).toContain("decision: 'DECLINED_LIVE_CAPTURE'");
    expect(consentRoute).toContain('entries: []');
  });

  it('keeps post-visit differential generation clinician-triggered', () => {
    const panel = source('components/app/EncounterDifferentialPanel.tsx');
    const liveNote = source('app/api/v1/sessions/[id]/live-note/route.ts');

    expect(panel).toContain('Ask copilot');
    expect(liveNote).not.toContain('runDifferential');
  });

  it('renders evidence beside the medical field it supports', () => {
    const view = source('components/app/MedicalNoteView.tsx');

    expect(view).toContain("evidenceFor(note, 'vitals')");
    expect(view).toContain("evidenceFor(note, 'assessment')");
    expect(view).toContain('source evidence');
  });
});
