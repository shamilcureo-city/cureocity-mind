export type BootstrapAdminStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';

export function isBootstrapAdminEmail(
  email: string | undefined,
  configuredEmails = process.env['BOOTSTRAP_ADMIN_EMAILS'] ?? '',
): boolean {
  if (!email) return false;
  const allow = configuredEmails
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

export function bootstrapAdminSignupData(
  email: string | undefined,
  emailVerified: boolean,
  configuredEmails = process.env['BOOTSTRAP_ADMIN_EMAILS'] ?? '',
): { role: 'ADMIN'; status: 'ACTIVE' } | Record<string, never> {
  return emailVerified && isBootstrapAdminEmail(email, configuredEmails)
    ? { role: 'ADMIN', status: 'ACTIVE' }
    : {};
}

/**
 * Repair only the historical bootstrap deadlock: an allowlisted account that
 * already has ADMIN but retained the schema default PENDING_VERIFICATION.
 * Explicit suspension/offboarding and non-admin accounts are never overridden.
 */
export function bootstrapAdminRecoveryData(
  email: string | undefined,
  emailVerified: boolean,
  account: { email: string; role: 'THERAPIST' | 'ADMIN'; status: BootstrapAdminStatus },
  configuredEmails = process.env['BOOTSTRAP_ADMIN_EMAILS'] ?? '',
): { status: 'ACTIVE' } | null {
  if (!emailVerified) return null;
  if (!isBootstrapAdminEmail(email, configuredEmails)) return null;
  if (account.email.trim().toLowerCase() !== email?.trim().toLowerCase()) return null;
  if (account.role !== 'ADMIN' || account.status !== 'PENDING_VERIFICATION') return null;
  return { status: 'ACTIVE' };
}
