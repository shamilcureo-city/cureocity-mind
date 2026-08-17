import { describe, expect, it } from 'vitest';
import {
  assertProductionReadiness,
  evaluateProductionReadiness,
  ProductionReadinessError,
} from './production-readiness';

const ready = {
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'orbit-prod',
  FIREBASE_CLIENT_EMAIL: 'firebase@example.test',
  FIREBASE_PRIVATE_KEY: 'private-key',
  KMS_BACKEND: 'gcp-kms',
  GCP_KMS_KEY_NAME:
    'projects/orbit/locations/asia-south1/keyRings/clinical/cryptoKeys/patient-data',
  WEBAUTHN_ORIGINS: 'https://orbit.example',
  WEBAUTHN_RP_ID: 'orbit.example',
  WEBAUTHN_TICKET_SECRET: 'a-secure-ticket-secret-with-32-characters',
  BILLING_BACKEND: 'razorpay',
} as NodeJS.ProcessEnv;

describe('production readiness', () => {
  it('does not impose production secrets in development', () => {
    expect(evaluateProductionReadiness({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('accepts a fully pinned production deployment', () => {
    expect(evaluateProductionReadiness(ready)).toEqual([]);
    expect(() => assertProductionReadiness(ready)).not.toThrow();
  });

  it('rejects unsupported providers and malformed Google Cloud KMS key names', () => {
    const issues = evaluateProductionReadiness({
      ...ready,
      KMS_BACKEND: 'aws-kms',
      GCP_KMS_KEY_NAME: 'not-a-resource-name',
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['KMS_BACKEND_UNSUPPORTED', 'KMS_KEY_REQUIRED']),
    );
  });

  it('fails closed for bypass, local KMS, mock billing, and unpinned WebAuthn', () => {
    const issues = evaluateProductionReadiness({ NODE_ENV: 'production', AUTH_BYPASS: 'true' });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'AUTH_BYPASS_FORBIDDEN',
        'FIREBASE_ADMIN_REQUIRED',
        'PRODUCTION_KMS_REQUIRED',
        'WEBAUTHN_ORIGINS_REQUIRED',
        'LIVE_BILLING_REQUIRED',
      ]),
    );
    expect(() => assertProductionReadiness({ NODE_ENV: 'production' })).toThrow(
      ProductionReadinessError,
    );
  });
});
