import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { isMindSessionPreparationEnabled } from './mind-session-preparation-feature';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
afterEach(() => vi.unstubAllEnvs());

describe('preparation entry integration boundaries (structural regression checks)', () => {
  it('defaults off until the independently approved migration and rollout', () => {
    vi.stubEnv('MIND_SESSION_PREPARATION_ENABLED', undefined);
    expect(isMindSessionPreparationEnabled()).toBe(false);
    vi.stubEnv('MIND_SESSION_PREPARATION_ENABLED', 'false');
    expect(isMindSessionPreparationEnabled()).toBe(false);
    vi.stubEnv('MIND_SESSION_PREPARATION_ENABLED', 'true');
    expect(isMindSessionPreparationEnabled()).toBe(true);
  });
  it('preparation selection returns before manual start, consent or capture', () => {
    const code = source('../components/app/RecordConfirmStrip.tsx');
    const end = code.indexOf('if (prepareOnly) return;');
    expect(end).toBeGreaterThan(code.indexOf('visitSelection.resolve('));
    for (const lifecycle of ['/manual-note', '/consent', '/live?flash=1', '/start`'])
      expect(code.indexOf(lifecycle)).toBeGreaterThan(end);
    expect(code).toContain('onPendingChange={setPreparationPending}');
    expect(code).toContain('onDirtyChange={setPreparationDirty}');
    expect(code).toContain("manual && !prepareOnly ? { mindDocumentationMode: 'MANUAL' }");
    expect(code).toContain('disabled={savedManualMode}');
  });
  it('binds the preflight component to both client and exact booking', () => {
    const code = source('../components/app/RecordingShell.tsx');
    expect(code).toContain("key={`${shell.client.id}:${context.sessionId ?? ''}`}");
    expect(code).toContain('expectedSessionId={context.sessionId}');
  });
  it('passes exact session identity from Today and keeps legacy device text separate', () => {
    const code = source('../components/app/TodaySessionCard.tsx');
    expect(code).toContain('sessionId={session.id}');
    expect(code).toContain('clientId={session.clientId}');
    expect(code).toContain('hideDeviceScratch={sessionPreparationEnabled}');
    expect(code).toContain('onDirtyChange={setPreparationDirty}');
    expect(code).toContain('busy !== null || preparationPending || preparationDirty');
    const history = source('../components/app/PreparePanel.tsx');
    expect(history).toContain('<PreparePanelForClient key={props.clientId}');
    expect(history).toContain('!hideDeviceScratch && <TodayIntent');
    expect(history).not.toMatch(/removeItem|localStorage\.clear/);
  });
  it('keeps live and ordinary/manual viewing read-only, separate from AI case context', () => {
    const live = source('../app/app/sessions/[id]/live/page.tsx');
    const normal = source('../app/app/sessions/[id]/page.tsx');
    for (const code of [live, normal]) {
      expect(code).toContain('isMindSessionPreparationEnabled()');
      expect(code).toMatch(/<SessionPreparationPanel[\s\S]*?\breadOnly\b/);
    }
    const gateway = readFileSync(
      new URL('../../../services/live-gateway/src/live-session.ts', import.meta.url),
      'utf8',
    );
    expect(gateway).not.toContain('MindSessionPreparation');
  });
});
