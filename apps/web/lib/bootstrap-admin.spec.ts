import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bootstrapAdminRecoveryData,
  bootstrapAdminSignupData,
  isBootstrapAdminEmail,
} from './bootstrap-admin';

const allowlist = 'founder@example.com, ops@example.com';
const sessionRoute = readFileSync(
  join(import.meta.dirname, '..', 'app', 'api', 'v1', 'auth', 'session', 'route.ts'),
  'utf8',
);

describe('bootstrap admin activation', () => {
  it('matches configured emails case-insensitively', () => {
    expect(isBootstrapAdminEmail(' Founder@Example.com ', allowlist)).toBe(true);
    expect(isBootstrapAdminEmail('other@example.com', allowlist)).toBe(false);
  });

  it('creates a bootstrap admin as active', () => {
    expect(bootstrapAdminSignupData('founder@example.com', true, allowlist)).toEqual({
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    expect(bootstrapAdminSignupData('other@example.com', true, allowlist)).toEqual({});
  });

  it('never grants bootstrap authority from an unverified email claim', () => {
    expect(bootstrapAdminSignupData('founder@example.com', false, allowlist)).toEqual({});
  });

  it('recovers only an allowlisted admin stuck pending verification', () => {
    expect(
      bootstrapAdminRecoveryData(
        'founder@example.com',
        true,
        { email: 'founder@example.com', role: 'ADMIN', status: 'PENDING_VERIFICATION' },
        allowlist,
      ),
    ).toEqual({ status: 'ACTIVE' });
    expect(
      bootstrapAdminRecoveryData(
        'founder@example.com',
        true,
        { email: 'founder@example.com', role: 'THERAPIST', status: 'PENDING_VERIFICATION' },
        allowlist,
      ),
    ).toBeNull();
  });

  it('never recovers from an unverified email claim', () => {
    expect(
      bootstrapAdminRecoveryData(
        'founder@example.com',
        false,
        { email: 'founder@example.com', role: 'ADMIN', status: 'PENDING_VERIFICATION' },
        allowlist,
      ),
    ).toBeNull();
  });

  it('never recovers when the verified claim does not match the stored account email', () => {
    expect(
      bootstrapAdminRecoveryData(
        'founder@example.com',
        true,
        { email: 'other@example.com', role: 'ADMIN', status: 'PENDING_VERIFICATION' },
        allowlist,
      ),
    ).toBeNull();
  });

  it.each(['SUSPENDED', 'OFFBOARDED', 'ACTIVE'] as const)(
    'never auto-activates an admin in %s state',
    (status) => {
      expect(
        bootstrapAdminRecoveryData(
          'founder@example.com',
          true,
          { email: 'founder@example.com', role: 'ADMIN', status },
          allowlist,
        ),
      ).toBeNull();
    },
  );
});

describe('bootstrap admin session integration', () => {
  it('creates allowlisted bootstrap admins with the active signup patch', () => {
    expect(sessionRoute).toContain(
      '...bootstrapAdminSignupData(decoded.email, decoded.email_verified === true)',
    );
  });

  it('audits recovery of an existing pending bootstrap admin', () => {
    expect(sessionRoute).toContain('bootstrapAdminRecoveryData(');
    expect(sessionRoute).toContain('decoded.email_verified === true');
    expect(sessionRoute).toContain("action: 'ADMIN_ACCOUNT_STATUS_CHANGED'");
    expect(sessionRoute).toContain("reason: 'bootstrap-admin-activation-recovery'");
    expect(sessionRoute).toContain('email: existing.email');
  });
});
