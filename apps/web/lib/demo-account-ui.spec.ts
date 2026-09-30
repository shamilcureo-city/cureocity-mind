import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('demo account presentation boundary', () => {
  it('uses a separated demo view with one disclosure instead of repeated row badges', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../app/console/accounts/page.tsx'),
      'utf8',
    );

    expect(source).toContain('<option value="synthetic">Demo accounts</option>');
    expect(source).not.toContain('<option value="all">');
    expect(source).toMatch(/Fictional\s+practitioner profiles and generated sessions/);
    expect(source).not.toMatch(/<Pill tone="muted">synthetic<\/Pill>/i);
  });

  it('keeps a compact disclosure on an individual demo profile', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../app/console/accounts/[id]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('isSynthetic: true');
    expect(source).toContain("account.isSynthetic ? '/console/accounts?dataset=synthetic'");
    expect(source).toMatch(/not a real\s+clinician or issued credential/);
  });
});
