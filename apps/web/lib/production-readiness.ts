export type ProductionReadinessCode =
  | 'AUTH_BYPASS_FORBIDDEN'
  | 'FIREBASE_ADMIN_REQUIRED'
  | 'PRODUCTION_KMS_REQUIRED'
  | 'KMS_KEY_REQUIRED'
  | 'KMS_BACKEND_UNSUPPORTED'
  | 'WEBAUTHN_ORIGINS_REQUIRED'
  | 'WEBAUTHN_RP_ID_REQUIRED'
  | 'WEBAUTHN_TICKET_SECRET_REQUIRED'
  | 'LIVE_BILLING_REQUIRED';

export interface ProductionReadinessIssue {
  code: ProductionReadinessCode;
  variable: string;
  message: string;
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['VERCEL_ENV'] === 'production' || env['NODE_ENV'] === 'production';
}

/** Pure deployment gate used by health checks, CI, and runtime security boundaries. */
export function evaluateProductionReadiness(
  env: NodeJS.ProcessEnv = process.env,
): ProductionReadinessIssue[] {
  if (!isProductionEnvironment(env)) return [];
  const issues: ProductionReadinessIssue[] = [];
  const requireValue = (
    variable: string,
    code: ProductionReadinessCode,
    message: string,
    minimumLength = 1,
  ) => {
    if ((env[variable]?.trim().length ?? 0) < minimumLength) {
      issues.push({ code, variable, message });
    }
  };

  if (env['AUTH_BYPASS'] === 'true') {
    issues.push({
      code: 'AUTH_BYPASS_FORBIDDEN',
      variable: 'AUTH_BYPASS',
      message: 'Production cannot use a shared demo identity.',
    });
  }
  for (const variable of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
    requireValue(variable, 'FIREBASE_ADMIN_REQUIRED', 'Firebase Admin credentials are incomplete.');
  }
  if (env['KMS_BACKEND'] !== 'gcp-kms') {
    issues.push({
      code:
        env['KMS_BACKEND'] && env['KMS_BACKEND'] !== 'local-dev'
          ? 'KMS_BACKEND_UNSUPPORTED'
          : 'PRODUCTION_KMS_REQUIRED',
      variable: 'KMS_BACKEND',
      message: 'Production must use the supported gcp-kms backend.',
    });
  }
  requireValue(
    'GCP_KMS_KEY_NAME',
    'KMS_KEY_REQUIRED',
    'A full Google Cloud KMS CryptoKey resource name is required.',
  );
  const gcpKeyName = env['GCP_KMS_KEY_NAME'] ?? '';
  if (
    gcpKeyName &&
    !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(gcpKeyName)
  ) {
    issues.push({
      code: 'KMS_KEY_REQUIRED',
      variable: 'GCP_KMS_KEY_NAME',
      message: 'GCP_KMS_KEY_NAME is not a full Cloud KMS CryptoKey resource name.',
    });
  }
  requireValue('WEBAUTHN_ORIGINS', 'WEBAUTHN_ORIGINS_REQUIRED', 'WebAuthn origins must be pinned.');
  requireValue('WEBAUTHN_RP_ID', 'WEBAUTHN_RP_ID_REQUIRED', 'A WebAuthn RP ID is required.');
  requireValue(
    'WEBAUTHN_TICKET_SECRET',
    'WEBAUTHN_TICKET_SECRET_REQUIRED',
    'The WebAuthn ticket secret must contain at least 32 characters.',
    32,
  );
  if (env['BILLING_BACKEND'] !== 'razorpay') {
    issues.push({
      code: 'LIVE_BILLING_REQUIRED',
      variable: 'BILLING_BACKEND',
      message: 'Production must use the live Razorpay backend.',
    });
  }
  return issues;
}

export class ProductionReadinessError extends Error {
  constructor(readonly issues: ProductionReadinessIssue[]) {
    super(`Production readiness failed: ${issues.map((issue) => issue.code).join(', ')}`);
    this.name = 'ProductionReadinessError';
  }
}

export function assertProductionReadiness(env: NodeJS.ProcessEnv = process.env): void {
  const issues = evaluateProductionReadiness(env);
  if (issues.length > 0) throw new ProductionReadinessError(issues);
}
