import { normaliseIndianPhone, isValidIndianPhone } from './phone';

/**
 * One shape for "a client being created", shared by both entry points.
 *
 * There were two new-client forms — the quick one on Record and the detailed
 * modal on Clients — each with its own state, its own payload builder and its
 * own idea of which consents were required. A therapist met them as two
 * different products, and the drift was where the "Validation failed" bug
 * lived. The draft, the readiness rule and the request body are now built
 * here, once, and both forms render the same fields.
 */

export type ClientDraftModality = 'CBT' | 'EMDR' | 'OTHER' | '';

export interface ClientDraft {
  fullName: string;
  /** Canonical (+91XXXXXXXXXX); `PhoneField` maintains it. */
  contactPhone: string;
  // Everything below is optional and lives behind "More details".
  contactEmail: string;
  dateOfBirth: string;
  presentingConcerns: string;
  preferredModality: ClientDraftModality;
  preferredLanguage: string;
  spokenLanguages: string[];
  // Consents.
  audioOk: boolean;
  noteOk: boolean;
  crossBorderOk: boolean;
  retentionExtended: boolean;
}

export const EMPTY_CLIENT_DRAFT: ClientDraft = {
  fullName: '',
  contactPhone: '',
  contactEmail: '',
  dateOfBirth: '',
  presentingConcerns: '',
  preferredModality: '',
  preferredLanguage: 'en',
  spokenLanguages: [],
  // Legacy capture and Doctor creation defaults remain pre-ticked. Mind's
  // administrative surfaces use createClientDraft() so they do not imply that
  // today's recording conversation already happened.
  audioOk: true,
  noteOk: true,
  crossBorderOk: true,
  retentionExtended: false,
};

export function createClientDraft(
  vertical: 'THERAPIST' | 'DOCTOR',
  purpose: 'ADMINISTRATIVE' | 'CAPTURE',
): ClientDraft {
  if (vertical === 'THERAPIST' && purpose === 'ADMINISTRATIVE') {
    return {
      ...EMPTY_CLIENT_DRAFT,
      audioOk: false,
      noteOk: false,
      crossBorderOk: false,
    };
  }
  return { ...EMPTY_CLIENT_DRAFT };
}

/** Preserve Scribe's create requirements after the shared schema is relaxed for Mind. */
export function validateCreateClientForVertical(
  input: { fullName?: string; contactPhone?: string; consents: unknown[] },
  vertical: 'THERAPIST' | 'DOCTOR',
): string | null {
  if (vertical !== 'DOCTOR') return null;
  if (!input.contactPhone) return 'A phone number is required when creating a patient.';
  if (input.consents.length === 0)
    return 'At least one consent is required when creating a patient.';
  return null;
}

/**
 * All three scribe consents are required — not just audio + note.
 *
 * `POST /sessions/[id]/start` and the live-token route refuse (409) a session
 * whose consent snapshot lacks CROSS_BORDER_PROCESSING, because Passes 2-5 run
 * on the global endpoint. The quick form used to treat cross-border as
 * optional, which happily created a client the therapist then could not record
 * until something else re-asked. Requiring it here closes that trap.
 */
export interface ClientDraftReadinessContext {
  vertical: 'THERAPIST' | 'DOCTOR';
  purpose: 'ADMINISTRATIVE' | 'SCHEDULING' | 'SHARING' | 'CAPTURE';
}

/**
 * The legacy/default rule remains strict for callers that are about to capture.
 * Mind administrative creation is intentionally lighter: today's consent is
 * confirmed later, against the actual session, in the unified preflight.
 */
export function isClientDraftReady(
  d: ClientDraft,
  context: ClientDraftReadinessContext = { vertical: 'THERAPIST', purpose: 'CAPTURE' },
): boolean {
  if (d.fullName.trim().length === 0) return false;
  if (context.vertical === 'THERAPIST' && context.purpose === 'ADMINISTRATIVE') return true;
  return isValidIndianPhone(d.contactPhone) && d.audioOk && d.noteOk && d.crossBorderOk;
}

/** The `POST /api/v1/clients` body. Optional fields are omitted, not sent empty. */
export function buildCreateClientBody(d: ClientDraft): Record<string, unknown> {
  const consents: Array<{ scope: string; scriptVersion: string; capturedVia: string }> = [];
  const grant = (scope: string) =>
    consents.push({ scope, scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' });
  if (d.audioOk) grant('AUDIO_RECORDING');
  if (d.noteOk) grant('AI_NOTE_GENERATION');
  if (d.crossBorderOk) grant('CROSS_BORDER_PROCESSING');
  if (d.retentionExtended) grant('DATA_RETENTION_EXTENDED');

  const body: Record<string, unknown> = {
    fullName: d.fullName.trim(),
    consents,
  };
  if (d.contactPhone.trim()) body['contactPhone'] = normaliseIndianPhone(d.contactPhone);
  if (d.contactEmail.trim()) body['contactEmail'] = d.contactEmail.trim();
  if (d.dateOfBirth) body['dateOfBirth'] = d.dateOfBirth;
  if (d.presentingConcerns.trim()) body['presentingConcerns'] = d.presentingConcerns.trim();
  if (d.preferredModality) body['preferredModality'] = d.preferredModality;
  // "en" is the DB default — sending it adds nothing.
  if (d.preferredLanguage && d.preferredLanguage !== 'en') {
    body['preferredLanguage'] = d.preferredLanguage;
  }
  if (d.spokenLanguages.length > 0) body['spokenLanguages'] = d.spokenLanguages;
  return body;
}
