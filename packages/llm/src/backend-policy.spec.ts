import { describe, expect, it } from 'vitest';
import {
  MockBackendRefusedError,
  containerPolicyInput,
  mockRefusalReason,
  resolveLlmBackend,
  vercelPolicyInput,
  type BackendPolicyInput,
} from './backend-policy';

const local: BackendPolicyInput = {
  requested: undefined,
  deployed: false,
  production: false,
  allowMockOptIn: false,
};

describe('resolveLlmBackend — no mock in any deployed environment', () => {
  it('returns vertex whenever explicitly requested (any environment)', () => {
    expect(resolveLlmBackend({ ...local, requested: 'vertex' })).toBe('vertex');
    expect(
      resolveLlmBackend({
        requested: 'vertex',
        deployed: true,
        production: true,
        allowMockOptIn: false,
      }),
    ).toBe('vertex');
  });

  it('allows mock on a genuinely-local machine (no deploy signals)', () => {
    expect(resolveLlmBackend(local)).toBe('mock');
    expect(resolveLlmBackend({ ...local, requested: 'mock' })).toBe('mock');
    // A typo locally still falls back to mock (dev convenience).
    expect(resolveLlmBackend({ ...local, requested: 'vetrex' })).toBe('mock');
  });

  it('REFUSES mock in production — unset', () => {
    expect(() =>
      resolveLlmBackend({
        requested: undefined,
        deployed: true,
        production: true,
        allowMockOptIn: false,
      }),
    ).toThrow(MockBackendRefusedError);
  });

  it('REFUSES mock in production even with the opt-in flag set', () => {
    expect(() =>
      resolveLlmBackend({
        requested: 'mock',
        deployed: true,
        production: true,
        allowMockOptIn: true,
      }),
    ).toThrow(MockBackendRefusedError);
  });

  it('REFUSES mock on a deployed PREVIEW (the manual-testing case) by default', () => {
    expect(() =>
      resolveLlmBackend({
        requested: undefined,
        deployed: true,
        production: false,
        allowMockOptIn: false,
      }),
    ).toThrow(MockBackendRefusedError);
  });

  it('permits mock on a NON-production deployed env ONLY with the explicit opt-in', () => {
    expect(
      resolveLlmBackend({
        requested: 'mock',
        deployed: true,
        production: false,
        allowMockOptIn: true,
      }),
    ).toBe('mock');
  });

  it('the refusal message names the offending LLM_BACKEND value', () => {
    try {
      resolveLlmBackend({
        requested: undefined,
        deployed: true,
        production: true,
        allowMockOptIn: false,
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain("'<unset>'");
      expect((e as Error).message).toMatch(/PRODUCTION/);
    }
  });
});

describe('mockRefusalReason', () => {
  it('returns null when the backend is allowed (vertex or permitted mock)', () => {
    expect(mockRefusalReason({ ...local, requested: 'vertex' })).toBeNull();
    expect(mockRefusalReason(local)).toBeNull();
    expect(
      mockRefusalReason({
        requested: 'mock',
        deployed: true,
        production: false,
        allowMockOptIn: true,
      }),
    ).toBeNull();
  });

  it('resolves the reason string when mock is refused', () => {
    const reason = mockRefusalReason({
      requested: undefined,
      deployed: true,
      production: true,
      allowMockOptIn: false,
    });
    expect(reason).toMatch(/REFUSING the mock backend/);
  });
});

describe('vercelPolicyInput (apps/web env mapping)', () => {
  it('treats Vercel production as production + deployed', () => {
    const p = vercelPolicyInput({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
    expect(p.production).toBe(true);
    expect(p.deployed).toBe(true);
    expect(() => resolveLlmBackend(p)).toThrow(MockBackendRefusedError);
  });

  it('treats Vercel preview as deployed-but-not-production (opt-in works)', () => {
    const p = vercelPolicyInput({ VERCEL_ENV: 'preview', NODE_ENV: 'production' });
    expect(p.production).toBe(false);
    expect(p.deployed).toBe(true);
    expect(() => resolveLlmBackend(p)).toThrow(MockBackendRefusedError);
    // ALLOW_MOCK_LLM re-permits mock on a preview (never in production).
    expect(
      resolveLlmBackend(
        vercelPolicyInput({ VERCEL_ENV: 'preview', ALLOW_MOCK_LLM: 'true', LLM_BACKEND: 'mock' }),
      ),
    ).toBe('mock');
  });

  it('H1/H2 — a self-hosted apps/web (NODE_ENV=production, no VERCEL_ENV) is DEPLOYED and refuses mock', () => {
    const p = vercelPolicyInput({ NODE_ENV: 'production' });
    expect(p.deployed).toBe(true);
    expect(() => resolveLlmBackend(p)).toThrow(MockBackendRefusedError);
  });

  it('local next dev (VERCEL_ENV unset, NODE_ENV=development) allows mock', () => {
    const p = vercelPolicyInput({ NODE_ENV: 'development' });
    expect(p.deployed).toBe(false);
    expect(resolveLlmBackend(p)).toBe('mock');
  });

  it('CI/vitest (NODE_ENV=test, no VERCEL_ENV) allows mock', () => {
    expect(resolveLlmBackend(vercelPolicyInput({ NODE_ENV: 'test' }))).toBe('mock');
  });
});

describe('containerPolicyInput (live-gateway env mapping)', () => {
  it('a Cloud Run service (K_SERVICE set) is production and refuses mock', () => {
    const p = containerPolicyInput({ K_SERVICE: 'live-gateway' });
    expect(p.production).toBe(true);
    expect(() => resolveLlmBackend(p)).toThrow(MockBackendRefusedError);
  });

  it('a prod container (NODE_ENV=production, Dockerfile-baked) refuses mock even with the opt-in', () => {
    const p = containerPolicyInput({ NODE_ENV: 'production', ALLOW_MOCK_LLM: 'true' });
    expect(p.production).toBe(true);
    expect(() => resolveLlmBackend(p)).toThrow(MockBackendRefusedError);
  });

  it('local gateway dev (no NODE_ENV=production, no K_SERVICE) allows mock', () => {
    expect(resolveLlmBackend(containerPolicyInput({}))).toBe('mock');
    expect(resolveLlmBackend(containerPolicyInput({ NODE_ENV: 'development' }))).toBe('mock');
  });
});
