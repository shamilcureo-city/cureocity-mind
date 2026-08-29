import type { PractitionerVertical } from '@cureocity/contracts';

/**
 * Mind journey switches. These flags govern therapist-only product changes;
 * Scribe requires separately approved doctor-product flags.
 */
export interface MindJourneyFlags {
  unifiedPreflight: boolean;
  safeFinalization: boolean;
  todayHome: boolean;
  sessionCloseout: boolean;
  clientWorkspace: boolean;
  clientCareLoop: boolean;
}

export type MindJourneyFlag = keyof MindJourneyFlags;

type MindJourneyEnvironment = Readonly<Record<string, string | undefined>>;

/** Build an explicit, independently reversible Mind flag snapshot. */
function mindJourneyFlagsFromEnv(env: MindJourneyEnvironment): MindJourneyFlags {
  return {
    unifiedPreflight: env['MIND_JOURNEY_UNIFIED_PREFLIGHT'] === 'true',
    safeFinalization: env['MIND_JOURNEY_SAFE_FINALIZATION'] === 'true',
    todayHome: env['MIND_JOURNEY_TODAY_HOME'] === 'true',
    sessionCloseout: env['MIND_JOURNEY_SESSION_CLOSEOUT'] === 'true',
    clientWorkspace: env['MIND_JOURNEY_CLIENT_WORKSPACE'] === 'true',
    clientCareLoop: env['MIND_JOURNEY_CLIENT_CARE_LOOP'] === 'true',
  };
}

/**
 * Evaluate a Mind journey flag at the practitioner boundary.
 *
 * The vertical check is authoritative: a globally enabled Mind flag remains
 * disabled for doctors, preventing shared app-shell code from changing Scribe.
 */
export function mindJourneyFlagEnabled(
  flag: MindJourneyFlag,
  vertical: PractitionerVertical,
  flags: MindJourneyFlags,
): boolean {
  return vertical === 'THERAPIST' && flags[flag];
}

/** Canonical server entry point: environment lookup plus vertical guard. */
export function mindJourneyFlagEnabledFromEnv(
  flag: MindJourneyFlag,
  vertical: PractitionerVertical,
  env: MindJourneyEnvironment = process.env,
): boolean {
  return mindJourneyFlagEnabled(flag, vertical, mindJourneyFlagsFromEnv(env));
}
