import type { InstrumentKey } from '@cureocity/clinical';

/**
 * CP-B — which validated instruments a Care session administers, in order.
 *
 * The live product measured ONLY PHQ-9 for everyone (the form's hardcoded
 * default), so an anxiety-primary user was screened on a depression scale and
 * GAD-7 — fully built — was never given. A real intake screens BOTH depression
 * and anxiety, so we always take both, and lead with the one the presenting
 * track points at (Grounding is anxiety/panic-led → GAD-7 first). Taking both
 * also keeps baseline and review on matching instruments, so reliable change
 * can be computed for each.
 */
export function careBaselineInstruments(modalityTrack?: string | null): InstrumentKey[] {
  return modalityTrack === 'GROUNDING' ? ['GAD7', 'PHQ9'] : ['PHQ9', 'GAD7'];
}
