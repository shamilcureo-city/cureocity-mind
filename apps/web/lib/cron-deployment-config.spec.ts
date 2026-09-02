import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import vercelConfig from '../vercel.json';

const cronRouteRoot = join(import.meta.dirname, '../app/api/v1/cron');

describe('durability-critical cron deployment config', () => {
  it('schedules every deployed cron route', () => {
    const deployedRoutes = readdirSync(cronRouteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/api/v1/cron/${entry.name}`)
      .sort();
    const scheduledRoutes = vercelConfig.crons.map((cron) => cron.path).sort();

    expect(scheduledRoutes).toEqual(deployedRoutes);
  });

  it('runs crisis-alert outbox recovery at the shortest supported practical interval', () => {
    expect(
      vercelConfig.crons.find((cron) => cron.path === '/api/v1/cron/crisis-alerts')?.schedule,
    ).toBe('* * * * *');
  });
});
