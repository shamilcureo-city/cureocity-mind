import type {
  PatientShareChannel,
  PatientShareStatus,
  ShareArtefactRef,
} from '@cureocity/contracts';

export const MIND_CLOSEOUT_ARTEFACTS = [
  { key: 'SESSION_TAKEAWAY', label: 'Session takeaway', secondary: false },
  { key: 'HOMEWORK', label: 'Homework', secondary: false },
  { key: 'INSTRUMENT_CHECKIN', label: 'Next-session check-in', secondary: false },
  { key: 'TREATMENT_PLAN', label: 'Treatment-plan update', secondary: false },
  { key: 'SIGNED_NOTE', label: 'Full signed note', secondary: true },
] as const;

export function mindCloseoutOptions(vertical: 'THERAPIST' | 'DOCTOR') {
  if (vertical !== 'THERAPIST') return { enabled: false } as const;
  return {
    enabled: true,
    steps: ['ARTEFACT', 'CHANNEL'] as const,
    completionOptions: ['SEND', 'DO_NOT_SEND'] as const,
  };
}

export interface DeliveryHistoryEntry {
  channel: PatientShareChannel;
  status: PatientShareStatus;
  sentAt: string | null;
  createdAt?: string;
}

export function choosePersistedDeliveryChannel(
  history: DeliveryHistoryEntry[],
  available: Partial<Record<PatientShareChannel, boolean>> = {
    WHATSAPP: true,
    EMAIL: true,
    PORTAL_LINK: true,
  },
): PatientShareChannel | null {
  return (
    [...history]
      .filter(
        (row) =>
          (row.status === 'SENT' || row.status === 'OPENED') && available[row.channel] !== false,
      )
      .sort((a, b) =>
        (b.sentAt ?? b.createdAt ?? '').localeCompare(a.sentAt ?? a.createdAt ?? ''),
      )[0]?.channel ?? null
  );
}

export interface MindOutcomeCandidate {
  label: string;
  artefact: ShareArtefactRef;
  secondary?: boolean;
  /** Present only for the therapist-authorized persisted takeaway candidate. */
  patientTakeaway?: string;
}

export function hydrateMindOutcomeSelection(candidates: MindOutcomeCandidate[]) {
  const persistedIndex = candidates.findIndex(
    (candidate) =>
      candidate.artefact.artefactType === 'SESSION_TAKEAWAY' &&
      Boolean(candidate.patientTakeaway?.trim()),
  );
  const outcomeIndex = persistedIndex >= 0 ? persistedIndex : 0;
  const persistedTakeaway =
    persistedIndex >= 0 ? (candidates[persistedIndex]?.patientTakeaway?.trim() ?? '') : '';
  return { candidates, outcomeIndex, takeaway: persistedTakeaway, persistedTakeaway };
}

export function shouldSavePatientTakeaway(takeaway: string, persistedTakeaway: string) {
  return takeaway.trim() !== persistedTakeaway.trim();
}

export function homeworkResponseDetail(response: unknown): string {
  if (!response || typeof response !== 'object' || !('outcome' in response))
    return 'Homework response received';
  switch (response.outcome) {
    case 'DONE':
      return 'Homework marked done';
    case 'PARTLY':
      return 'Homework marked partly done';
    case 'NOT_YET':
      return 'Homework marked not yet';
    default:
      return 'Homework response received';
  }
}

export function successfulPreference(
  results: { channel: PatientShareChannel; status: PatientShareStatus }[],
) {
  return results.find((row) => row.status === 'SENT' || row.status === 'OPENED')?.channel ?? null;
}
