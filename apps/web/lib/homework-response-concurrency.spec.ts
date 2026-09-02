import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  join(import.meta.dirname, '../app/api/v1/p/[token]/homework/route.ts'),
  'utf8',
);

describe('homework response concurrency boundary', () => {
  it('serializes all outcomes and rejects any second response', () => {
    expect(route).toContain('pg_advisory_xact_lock');
    expect(route).toContain('current.response !== null');
    expect(route).toContain('throw new HomeworkReplayError()');
    expect(route).toContain('status: 409');
  });
});
