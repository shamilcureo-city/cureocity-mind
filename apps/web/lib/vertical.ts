import type { PractitionerVertical } from '@cureocity/contracts';

/**
 * Sprint DV2 — vertical-aware UI vocabulary. One system, two faces: a
 * therapist's "client" is a doctor's "patient". Centralised so the noun
 * is consistent everywhere a shared component renders for both verticals
 * (e.g. the roster header + create modal), and a future vertical edits
 * one map. See docs/DOCTOR_VERTICAL.md.
 */
export interface Noun {
  singular: string;
  plural: string;
  Singular: string;
  Plural: string;
}

const SUBJECT: Record<PractitionerVertical, Noun> = {
  THERAPIST: { singular: 'client', plural: 'clients', Singular: 'Client', Plural: 'Clients' },
  DOCTOR: { singular: 'patient', plural: 'patients', Singular: 'Patient', Plural: 'Patients' },
};

export function subjectNounFor(vertical: PractitionerVertical | null | undefined): Noun {
  return SUBJECT[vertical ?? 'THERAPIST'];
}
