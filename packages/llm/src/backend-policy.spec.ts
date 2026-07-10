import { describe, expect, it } from 'vitest';
import {
  MockBackendRefusedError,
  mockRefusalReason,
  resolveLlmBackend,
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

  it('returns the reason string when mock is refused', () => {
    const reason = mockRefusalReason({
      requested: undefined,
      deployed: true,
      production: true,
      allowMockOptIn: false,
    });
    expect(reason).toMatch(/REFUSING the mock backend/);
  });
});
