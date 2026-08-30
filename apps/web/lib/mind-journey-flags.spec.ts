import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mindJourneyFlagEnabled,
  mindJourneyFlagEnabledFromEnv,
  type MindJourneyFlags,
} from './mind-journey-flags';

const allEnabled: MindJourneyFlags = {
  unifiedPreflight: true,
  safeFinalization: true,
  todayHome: true,
  sessionCloseout: true,
  clientWorkspace: true,
  clientCareLoop: true,
};

describe('Mind journey feature flags', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fail closed for doctors even when every Mind flag is enabled', () => {
    for (const flag of Object.keys(allEnabled) as Array<keyof MindJourneyFlags>) {
      expect(mindJourneyFlagEnabled(flag, 'DOCTOR', allEnabled)).toBe(false);
    }
  });

  it('lets therapists opt into one Mind journey slice without enabling the others', () => {
    const oneEnabled: MindJourneyFlags = {
      ...allEnabled,
      unifiedPreflight: false,
      safeFinalization: false,
      sessionCloseout: false,
      clientWorkspace: false,
      clientCareLoop: false,
    };

    expect(mindJourneyFlagEnabled('todayHome', 'THERAPIST', oneEnabled)).toBe(true);
    expect(mindJourneyFlagEnabled('sessionCloseout', 'THERAPIST', oneEnabled)).toBe(false);
  });

  it('reads the current environment through the vertical boundary', () => {
    vi.stubEnv('MIND_JOURNEY_TODAY_HOME', 'true');
    vi.stubEnv('MIND_JOURNEY_SESSION_CLOSEOUT', 'false');

    expect(mindJourneyFlagEnabledFromEnv('todayHome', 'THERAPIST')).toBe(true);
    expect(mindJourneyFlagEnabledFromEnv('sessionCloseout', 'THERAPIST')).toBe(false);
    expect(mindJourneyFlagEnabledFromEnv('todayHome', 'DOCTOR')).toBe(false);
  });

  it('loads each switch independently and accepts only an explicit true value', () => {
    const env = {
      MIND_JOURNEY_UNIFIED_PREFLIGHT: 'true',
      MIND_JOURNEY_SAFE_FINALIZATION: 'false',
      MIND_JOURNEY_TODAY_HOME: '1',
      MIND_JOURNEY_SESSION_CLOSEOUT: 'TRUE',
      MIND_JOURNEY_CLIENT_WORKSPACE: undefined,
      MIND_JOURNEY_CLIENT_CARE_LOOP: 'true',
    };

    expect(mindJourneyFlagEnabledFromEnv('unifiedPreflight', 'THERAPIST', env)).toBe(true);
    expect(mindJourneyFlagEnabledFromEnv('safeFinalization', 'THERAPIST', env)).toBe(false);
    expect(mindJourneyFlagEnabledFromEnv('todayHome', 'THERAPIST', env)).toBe(false);
    expect(mindJourneyFlagEnabledFromEnv('sessionCloseout', 'THERAPIST', env)).toBe(false);
    expect(mindJourneyFlagEnabledFromEnv('clientWorkspace', 'THERAPIST', env)).toBe(false);
    expect(mindJourneyFlagEnabledFromEnv('clientCareLoop', 'THERAPIST', env)).toBe(true);
  });
});
