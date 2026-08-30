import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function webSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

describe('Sprint 1 Mind reliable session journey integration', () => {
  it('routes every Mind start entry through the shared Record preflight surface', () => {
    const preflight = webSource('components/app/MindSessionPreflight.tsx');
    expect(preflight).toContain('runCapturePreflight');
    expect(preflight).toContain("fetch('/api/v1/live/health'");
    expect(preflight).toContain('onSelectedDeviceIdChange');
    const confirm = webSource('components/app/RecordConfirmStrip.tsx');
    expect(confirm).toContain('onSelectedDeviceIdChange={setSelectedDeviceId}');
    expect(confirm).toContain('selectedDeviceId');
    expect(webSource('lib/audio/use-live-stream.ts')).toContain('opts.selectedDeviceId');
    expect(webSource('lib/audio/use-session-recorder.ts')).toContain('opts.selectedDeviceId');

    for (const path of [
      'components/app/TodaySessionCard.tsx',
      'components/app/WalkInSheet.tsx',
      'app/app/clients/[id]/page.tsx',
    ]) {
      expect(webSource(path), path).toContain('mindStartEntryHref');
    }
  });

  it('keeps the doctor encounter start outside Mind preflight and preserves token-is-start', () => {
    const doctor = webSource('components/app/StartEncounterButton.tsx');
    expect(doctor).not.toContain('MindSessionPreflight');
    expect(doctor).not.toContain('coordinateMindSessionStart');

    const liveToken = webSource('app/api/v1/sessions/[id]/live-token/route.ts');
    expect(liveToken).toContain('captureActivationTransitionData(');
    expect(liveToken).toContain('session.psychologist.vertical');
  });

  it('integrates durable drafts, guarded navigation, confirmed end and transcript rescue', () => {
    const live = webSource('components/app/TherapistLiveSession.tsx');
    expect(live).toContain('saveRecoveryDraft');
    expect(live).toContain('loadRecoveryDraft');
    expect(live).toContain('beforeunload');
    expect(live).toContain('aria-label="End session?"');
    expect(live).toContain('Retry finalization');
    expect(live).toContain('Save transcript');
    expect(live).toContain('Return to Today');
  });

  it('keeps the essential recording status and End action sticky on mobile', () => {
    const live = webSource('components/app/TherapistLiveSession.tsx');
    expect(live).toContain('sticky top-0');
    const batch = webSource('components/app/LiveRecorder.tsx');
    expect(batch).toContain('sticky bottom-0');
    expect(batch).toContain('aria-label="End session?"');
  });
});
