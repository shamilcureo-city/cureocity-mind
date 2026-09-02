import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidInternationalPhoneNumber } from '../components/portal/ClientPhoneSignIn';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('returning-client phone sign-in architecture', () => {
  it('offers the same reusable phone OTP flow on claim and care-home pages', () => {
    const componentPath = join(root, 'components/portal/ClientPhoneSignIn.tsx');
    expect(existsSync(componentPath)).toBe(true);

    const claim = read('app/p/claim/[token]/page.tsx');
    const home = read('app/p/home/page.tsx');
    const signIn = read('components/portal/ClientPhoneSignIn.tsx');

    expect(claim).toContain('ClientPhoneSignIn');
    expect(home).toContain('ClientPhoneSignIn');
    expect(signIn).toContain('signInWithPhoneNumber');
    expect(signIn).toContain('createRecaptchaVerifier');
    expect(signIn).toContain('clearVerifier');
    expect(signIn).toContain('role="alert"');
    expect(signIn).toContain('role="status"');
  });

  it.each([
    ['+919876543210', true],
    ['+14155552671', true],
    ['+442071838750', true],
    ['919876543210', false],
    ['+0123456789', false],
    ['+1234567', false],
    ['+1234567890123456', false],
  ])('validates international E.164 phone number %s', (phone, expected) => {
    expect(isValidInternationalPhoneNumber(phone)).toBe(expected);
  });

  it('signs into care home without requiring or redeeming a claim token', () => {
    const home = read('app/p/home/page.tsx');

    expect(home).toContain('<ClientPhoneSignIn');
    expect(home).not.toContain('/claim-tokens/');
    expect(home).not.toContain('/redeem');
  });
});
