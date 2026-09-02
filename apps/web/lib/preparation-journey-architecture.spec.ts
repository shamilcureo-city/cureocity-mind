import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function expectOrder(source: string, labels: string[]) {
  const positions = labels.map((label) => source.indexOf(label));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe('one freshness-aware preparation journey', () => {
  it('uses the same preparation component on Today and client Overview', () => {
    const today = read('components/app/TodaySessionCard.tsx');
    const overview = read('app/app/clients/[id]/page.tsx');

    expect(today).toContain('<PreparePanel');
    expect(overview).toContain('<PreparePanel');
  });

  it('shows one clinical reading order', () => {
    const panel = read('components/app/PreparePanel.tsx');
    expectOrder(panel, [
      'Safety',
      'What changed',
      'Decisions already made',
      'Questions to carry',
      'Homework follow-up',
      'Suggested direction',
    ]);
  });

  it('carries persisted brief freshness and an explicit refresh control', () => {
    const contract = read('../../packages/contracts/src/prepare.ts');
    const route = read('app/api/v1/clients/[id]/prepare/route.ts');
    const panel = read('components/app/PreparePanel.tsx');
    const freshness = read('lib/preparation-freshness.ts');

    expect(contract).toContain('briefGeneratedAt: IsoDateTimeSchema.nullable()');
    expect(route).toContain('createdAt: true');
    expect(route).toContain("{ endedAt: { sort: 'desc', nulls: 'last' } }");
    expect(route).toContain("{ scheduledAt: 'desc' }");
    expect(route).toContain("{ id: 'desc' }");
    expect(route).toContain('briefGeneratedAt:');
    expect(route).toContain('canDiscloseWholeBrief && cachedBrief !== null');
    expect(route).toContain('cachedBriefRow!.createdAt.toISOString()');
    expect(existsSync(join(root, 'lib/preparation-freshness.ts'))).toBe(true);
    expect(freshness).toContain('Generated ');
    expect(freshness).toContain('Stale');
    expect(panel).toContain('Refresh');
  });

  it('uses the same deterministic latest-completed ordering when Refresh generates a brief', () => {
    const refreshRoute = read('app/api/v1/clients/[id]/pre-session-brief/route.ts');

    expect(refreshRoute).toContain("{ endedAt: { sort: 'desc', nulls: 'last' } }");
    expect(refreshRoute).toContain("{ scheduledAt: 'desc' }");
    expect(refreshRoute).toContain("{ id: 'desc' }");
    expect(refreshRoute).not.toContain("orderBy: { endedAt: 'desc' }");
  });
});
