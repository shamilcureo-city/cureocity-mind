import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Mind client care loop architecture', () => {
  it('creates a client inside scheduling without leaving Today', () => {
    const schedule = read('components/app/ScheduleSessionPanel.tsx');
    const create = read('components/app/CreateClientModal.tsx');

    expect(schedule).toContain('<CreateClientModal');
    expect(schedule).toContain('redirectOnCreated={false}');
    expect(schedule).toContain('Add a client');
    expect(schedule).not.toContain('Add one from <strong>Clients</strong> first');
    expect(create).toContain('redirectOnCreated = true');
    expect(create).toContain('if (redirectOnCreated)');
  });
});
