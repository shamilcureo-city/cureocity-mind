import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Sprint 5.5 authenticated care access architecture', () => {
  it('uses client Firebase auth and never practitioner session provisioning', () => {
    const claim = read('app/p/claim/[token]/page.tsx');
    const phoneSignIn = read('components/portal/ClientPhoneSignIn.tsx');
    expect(claim).toContain('ClientPhoneSignIn');
    expect(phoneSignIn).toContain('signInWithPhoneNumber');
    expect(claim).toContain('/redeem');
    const redeem = read('app/api/v1/claim-tokens/[token]/redeem/route.ts');
    const phoneMatch = read('lib/client-claim-phone.ts');
    expect(redeem).toContain('phoneNumber');
    expect(phoneMatch).toContain('contactPhoneEncrypted');
    expect(claim).not.toContain('/api/v1/auth/session');
    expect(phoneSignIn).not.toContain('/api/v1/auth/session');
  });

  it('marks authenticated care responses private and non-indexable', () => {
    const api = read('app/api/v1/p/home/route.ts');
    const layout = read('app/p/home/layout.tsx');
    expect(api).toContain("'Cache-Control': 'private, no-store'");
    expect(api).toContain("'Referrer-Policy': 'no-referrer'");
    expect(api).toContain("status: { in: ['SENT', 'OPENED'] }");
    expect(layout).toContain('index: false');
    expect(layout).toContain("referrer: 'no-referrer'");
  });

  it('keeps Doctor artefact links outside the Mind care home', () => {
    const portal = read('app/p/[token]/page.tsx');
    expect(portal).toContain("row.psychologist.vertical === 'THERAPIST'");
    expect(portal).toContain("snapshot?.kind !== 'AFTER_VISIT_SUMMARY'");
    expect(portal).toContain("snapshot?.kind !== 'RX_PAD'");
    expect(portal).toContain("['SENT', 'OPENED'].includes(current.status)");
    expect(portal).toContain("data: { openedAt: now, status: 'OPENED' }");
    expect(portal).toContain('lockShareFamily(tx, candidate)');
    expect(portal).toContain('await tx.patientShare.updateMany({');
    expect(portal).toContain('PortalUnavailableError');
    expect(portal).not.toContain("snapshot?.kind !== 'SIGNED_NOTE'");
    expect(portal).toContain("referrer: 'no-referrer'");
  });
});
