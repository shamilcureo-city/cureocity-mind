/**
 * The Care therapist roster — one home (CG2). Onboarding picks from it;
 * Settings switches within it (persona choice is clinical alliance and is
 * never paywalled). Voices are the probe-verified prebuilt set
 * (CARE_LIVE_VOICES); styles map to the prompt's STYLE_BLOCK.
 */
export const CARE_PERSONAS = [
  { name: 'Meera', voiceName: 'Kore', style: 'gentle', blurb: 'gentle · unhurried' },
  { name: 'Dev', voiceName: 'Puck', style: 'direct', blurb: 'direct · warm' },
  { name: 'Asha', voiceName: 'Aoede', style: 'gentle', blurb: 'calm · bright' },
] as const;

export type CarePersona = (typeof CARE_PERSONAS)[number];
