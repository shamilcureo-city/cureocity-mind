import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const absolute = join(path, name);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(ts|tsx)$/.test(name) ? [absolute] : [];
  });
}

describe('client-owned journey and plan links', () => {
  it('eliminates missing historical client anchors everywhere', () => {
    const offenders = sourceFiles(root)
      .filter((path) => !path.endsWith('client-journey-links.spec.ts'))
      .filter((path) => /#care-measures|#instruments/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it('eliminates legacy client overview journey fragments everywhere', () => {
    const offenders = sourceFiles(root)
      .filter((path) => !path.endsWith('client-journey-links.spec.ts'))
      .filter((path) => /\/app\/clients\/\$\{[^}]+\}#journey/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it('lands outcome actions on the selected client-owned measure', () => {
    const journey = read('lib/journey.ts');
    const briefing = read('lib/case-briefing.ts');
    const todayCard = read('components/app/TodaySessionCard.tsx');
    const dashboard = read('app/app/dashboard/page.tsx');
    const measurePanel = read('components/app/CareMeasurePanel.tsx');

    expect(journey).toContain('/journey#measure-phq9');
    expect(briefing).toContain('/journey#measure-phq9');
    expect(todayCard).toContain('/journey#measure-${');
    expect(dashboard).toContain('/journey#measure-${');
    expect(measurePanel).toContain('id={`measure-${m.instrumentKey.toLowerCase()}`}');
    expect(read('components/app/CareNextSessionPanel.tsx')).toContain('id="care-questions"');
  });

  it('renders the full cumulative care engine from the client route', () => {
    const journeyPage = read('app/app/clients/[id]/journey/page.tsx');
    const copilot = read('components/app/AICopilotTab.tsx');

    expect(journeyPage).toContain('<ClientJourneyContent');
    expect(journeyPage).toContain("status: 'COMPLETED'");
    expect(journeyPage).toContain("{ endedAt: { sort: 'desc', nulls: 'last' } }");
    expect(journeyPage).toContain("{ scheduledAt: 'desc' }");
    expect(journeyPage).toContain("{ id: 'desc' }");
    expect(journeyPage).toContain('sessionId={client.sessions[0]?.id ?? null}');
    expect(copilot).toContain('export async function ClientJourneyContent');
    expect(copilot).toContain('sessionId: string | null');
    expect(copilot).toContain(': null;');
    expect(read('components/app/CareNextSessionPanel.tsx')).toContain('reviewHref: string | null');
  });

  it('renders the full plan-of-care document from the client route', () => {
    const planPage = read('app/app/clients/[id]/plan/page.tsx');
    const planTab = read('components/app/PlanOfCareTab.tsx');
    const sheet = read('components/app/PlanOfCareSheet.tsx');

    expect(planPage).toContain('<ClientPlanOfCareContent');
    expect(planPage).toContain('sessionId={null}');
    expect(planTab).toContain('export async function ClientPlanOfCareContent');
    expect(planTab).toContain('sessionId: string | null');
    expect(sheet).not.toContain('/app/sessions/${data.sessionId}?tab=copilot');
    expect(sheet).toContain('/app/clients/${data.clientId}/plan#poc-tools');
    expect(sheet).toContain('/app/clients/${data.clientId}/journey#measure-phq9');
  });

  it('opens plan tools when the plan-tools fragment is selected', () => {
    const disclosure = read('components/app/PlanToolsDisclosure.tsx');
    const planTab = read('components/app/PlanOfCareTab.tsx');

    expect(disclosure).toContain("window.location.hash === '#poc-tools'");
    expect(disclosure).toContain("window.addEventListener('hashchange'");
    expect(planTab).toContain('<PlanToolsDisclosure>');
  });

  it('makes client routes own longitudinal state even without a completed session', () => {
    const journeyPage = read('app/app/clients/[id]/journey/page.tsx');
    const copilot = read('components/app/AICopilotTab.tsx');
    const engine = read('lib/care-engine-compose.ts');

    expect(journeyPage).toContain('sessionId={client.sessions[0]?.id ?? null}');
    expect(journeyPage).not.toContain('if (client.sessions.length === 0) notFound()');
    expect(copilot).toContain('planHref={`/app/clients/${clientId}/plan`}');
    expect(engine).toContain('`/app/clients/${clientId}/journey`');
  });
});
