import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, '../components/app/ShareModal.tsx'), 'utf8');

describe('Mind outcome delivery choices', () => {
  it('keeps alternate channels behind an explicit disclosure', () => {
    expect(source).toContain('More delivery options');
    expect(source).toContain('<details');
  });
});
