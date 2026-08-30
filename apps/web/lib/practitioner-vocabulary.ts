import type { PractitionerVertical } from '@cureocity/contracts';

export interface PractitionerVocabulary {
  people: 'Clients' | 'Patients';
  work: 'Sessions' | 'Encounters';
  home: 'Today' | 'Clinic';
  start: 'Start session' | 'Start encounter';
  completion: 'Review & Close' | 'Review & Sign';
}

const MIND_VOCABULARY: PractitionerVocabulary = {
  people: 'Clients',
  work: 'Sessions',
  home: 'Today',
  start: 'Start session',
  completion: 'Review & Close',
};

const SCRIBE_VOCABULARY: PractitionerVocabulary = {
  people: 'Patients',
  work: 'Encounters',
  home: 'Clinic',
  start: 'Start encounter',
  completion: 'Review & Sign',
};

export function practitionerVocabulary(vertical: PractitionerVertical): PractitionerVocabulary {
  return vertical === 'DOCTOR' ? SCRIBE_VOCABULARY : MIND_VOCABULARY;
}
