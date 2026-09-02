import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(join(import.meta.dirname, '../app/api/v1/share/route.ts'), 'utf8');

describe('share provider error redaction', () => {
  it('never persists or returns provider-supplied error details', () => {
    expect(route).not.toContain('errorDetail:');
  });
});
