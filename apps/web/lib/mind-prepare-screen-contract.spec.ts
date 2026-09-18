import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function normalizedFetchTargets(source: string): string[] {
  return [...source.matchAll(/fetch\(\s*([`'"])([\s\S]*?)\1/g)]
    .map((match) => match[2]!.replace(/\$\{[^}]+\}/g, '${}'))
    .sort();
}

describe('Mind Prepare screen presentation contract', () => {
  it('keeps the canonical start route on the shared shell and opens with Prepare hierarchy', () => {
    const page = read('app/app/encounters/new/page.tsx');
    const shell = read('components/app/RecordingShell.tsx');
    const confirm = read('components/app/RecordConfirmStrip.tsx');

    expect(page).toContain('<RecordingShell');
    expect(shell).toContain('<RecordConfirmStrip');
    expect(confirm).toContain("import { MindSessionPhaseRail } from './MindSessionPhaseRail'");
    expect(confirm).toContain('<MindSessionPhaseRail active="prepare"');
    expect(confirm).toContain('Prepare for {clientName}');
    expect(confirm).toContain('formatIstDateTime(selectedVisitSettings.scheduledAt)');
  });

  it('separates the clinician scan path from optional clinical and recording depth', () => {
    const confirm = read('components/app/RecordConfirmStrip.tsx');
    const prepare = read('components/app/PreparePanel.tsx');

    expect(confirm).toContain('Where we left off');
    expect(confirm).toContain('Today’s focus');
    expect(confirm).toContain('Ready to start');

    const readinessHeading = confirm.indexOf('Ready to start');
    expect(readinessHeading).toBeGreaterThan(confirm.lastIndexOf('<aside', readinessHeading));
    expect(confirm.indexOf('</aside>', readinessHeading)).toBeGreaterThan(readinessHeading);

    expect(prepare).toContain('Full preparation (optional)');
    expect(prepare).toContain('data && (!summaryVisible || open)');
    expect(confirm).toContain('Change recording settings');
    expect(confirm.indexOf('Where we left off')).toBeLessThan(readinessHeading);
    expect(confirm.indexOf('Today’s focus')).toBeLessThan(readinessHeading);
  });

  it('uses Prepare & start on Today without removing either capture choice', () => {
    const today = read('components/app/TodaySessionCard.tsx');

    expect(today).toContain("primaryLabel: 'Prepare & start'");
    expect(today).toContain("captureMode: 'LIVE'");
    expect(today).toContain("captureMode: 'BATCH'");
    expect(today).toContain('Live scribe');
    expect(today).toContain('Record only');
    expect(today).toContain('href={primaryStart.href}');
    expect(today).toContain('href={secondaryStart.href}');
  });

  it('preserves live, record-only, dictation, upload and manual documentation paths', () => {
    const shell = read('components/app/RecordingShell.tsx');
    const confirm = read('components/app/RecordConfirmStrip.tsx');

    expect(shell).toContain("type ConfirmMode = 'live-capture' | 'dictation' | 'upload'");
    expect(shell).toContain("type Intent = 'live' | 'dictation' | 'upload'");
    expect(shell).toContain("live: 'live-capture'");
    expect(shell).toContain("dictation: 'dictation'");
    expect(shell).toContain("upload: 'upload'");

    expect(confirm).toContain('title="Use the scribe"');
    expect(confirm).toContain('title="Write my own note"');
    expect(confirm).toContain("capture === 'live'");
    expect(confirm).toContain("capture === 'batch'");
    expect(confirm).toContain('/manual-note`');
    expect(confirm).toContain('/live?flash=1');
    expect(confirm).toContain('/start`');
    expect(confirm).toContain("mode === 'dictation'");
    expect(confirm).toContain("mode === 'upload'");
  });

  it('keeps consent and readiness authoritative before any scribe start', () => {
    const confirm = read('components/app/RecordConfirmStrip.tsx');

    expect(confirm).toContain('confirmedToday &&');
    expect(confirm).toContain('Object.values(missingRequired).every(Boolean)');
    expect(confirm).toContain('(!needsDevicePreflight || preflightReady)');
    expect(confirm).toContain('<MindSessionPreflight');
    expect(confirm).toContain("liveServiceRequired={method === 'mic' && capture === 'live'}");
    expect(confirm).toContain('onReadyChange={setPreflightReady}');
    expect(confirm).toContain('onSelectedDeviceIdChange={setSelectedDeviceId}');
  });

  it('does not add or reroute network calls in the presentation-only redesign', () => {
    const page = read('app/app/encounters/new/page.tsx');
    const shell = read('components/app/RecordingShell.tsx');
    const confirm = read('components/app/RecordConfirmStrip.tsx');
    const prepare = read('components/app/PreparePanel.tsx');
    const preflight = read('components/app/MindSessionPreflight.tsx');
    const today = read('components/app/TodaySessionCard.tsx');

    expect(page).not.toContain('fetch(');
    expect(shell).not.toContain('fetch(');
    expect(normalizedFetchTargets(confirm)).toEqual([
      '/api/v1/clients/${}/session-defaults',
      '/api/v1/clients/${}/session-defaults?guides=1',
      '/api/v1/sessions/${}/consent',
      '/api/v1/sessions/${}/manual-note',
      '/api/v1/sessions/${}/start',
      '/api/v1/sessions/${}/start',
    ]);
    expect(normalizedFetchTargets(prepare)).toEqual([
      '/api/v1/clients/${}/agreements?cursor=${}',
      '/api/v1/clients/${}/pre-session-brief?refresh=1',
      '/api/v1/clients/${}/prepare',
      '/api/v1/sessions/${}/agreements',
    ]);
    expect(normalizedFetchTargets(preflight)).toEqual(['/api/v1/live/health']);
    expect(normalizedFetchTargets(today)).toEqual([
      '/api/v1/sessions/${}/no-show',
      '/api/v1/sessions/${}/no-show/undo',
    ]);
  });
});
