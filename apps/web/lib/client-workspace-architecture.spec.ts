import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Mind longitudinal client workspace architecture', () => {
  it('publishes one persistent client-owned navigation across all five routes', () => {
    const routes = [
      'app/app/clients/[id]/page.tsx',
      'app/app/clients/[id]/journey/page.tsx',
      'app/app/clients/[id]/plan/page.tsx',
      'app/app/clients/[id]/sessions/page.tsx',
      'app/app/clients/[id]/shared/page.tsx',
    ];
    for (const route of routes) expect(existsSync(join(root, route)), route).toBe(true);

    const nav = read('components/app/ClientWorkspaceNav.tsx');
    expect(nav).toContain("{ key: 'overview', label: 'Overview'");
    expect(nav).toContain("{ key: 'journey', label: 'Journey & outcomes'");
    expect(nav).toContain("{ key: 'plan', label: 'Plan of care'");
    expect(nav).toContain("{ key: 'sessions', label: 'Sessions'");
    expect(nav).toContain("{ key: 'shared', label: 'Shared with client'");
  });

  it('makes Overview an operational client home rather than a historical-session index', () => {
    const overview = read('app/app/clients/[id]/page.tsx');
    const view = read('components/app/MindClientOverview.tsx');

    expect(overview).toContain('<ClientWorkspaceNav');
    const summary = read('lib/mind-client-overview.ts');
    expect(overview).toContain('<MindClientOverview');
    expect(view).toContain('nextAppointment');
    expect(view).toContain('latestCompletedSession');
    expect(view).toContain('Record-based suggestion');
    expect(view).toContain('confirmed clinical outcome');
    expect(overview).toContain('<PreparePanel clientId={client.id} summaryVisible />');
    expect(view.indexOf('<h1')).toBeLessThan(view.indexOf('{preparationPanel}'));
    expect(view).toContain('<ButtonLink href={entryHref}');
    expect(view).toContain('captureMode: defaultCapture');
    expect(view).toContain('Prepare session');
    expect(overview).toContain('Schedule follow-up');
    expect(overview).toContain('sessions={client.sessions}');
    expect(view).toContain('buildMindClientOverview(sessions, now)');
    expect(summary).toContain("session.status === 'COMPLETED'");
    expect(summary).toContain('.slice(0, 3)');
    expect(view).toContain('recentSessions.map');
    expect(view).toContain('/sessions`');
    expect(overview).toContain('<DataRightsCard');
    expect(overview.indexOf('<PageCrisisBanner')).toBeLessThan(overview.indexOf('<PreparePanel'));
    expect(view.indexOf('{safetyBanner}')).toBeLessThan(view.indexOf('<header'));
    expect(overview).not.toContain('client.sessions[0]?.scheduledAt');
    expect(overview).not.toContain('?tab=copilot&sub=progress');
  });

  it('rejects Doctors before every Mind client-data lookup', () => {
    const routes = [
      'app/app/clients/[id]/page.tsx',
      'app/app/clients/[id]/journey/page.tsx',
      'app/app/clients/[id]/plan/page.tsx',
      'app/app/clients/[id]/sessions/page.tsx',
      'app/app/clients/[id]/shared/page.tsx',
    ];
    for (const route of routes) {
      const source = read(route);
      const guard = source.indexOf("therapist.vertical === 'DOCTOR'");
      expect(guard, route).toBeGreaterThan(-1);
      expect(guard, route).toBeLessThan(source.indexOf('prisma.client'));
      expect(source, route).toContain("redirect('/app/clinic')");
    }
  });

  it('keeps Scribe patient routes separate from the Mind client workspace', () => {
    const nav = read('components/app/ClientWorkspaceNav.tsx');
    const patient = read('app/app/patients/[id]/page.tsx');

    expect(nav).not.toContain('/app/patients');
    expect(patient).not.toContain('ClientWorkspaceNav');
    expect(patient).toContain('/app/patients/');
  });
});
