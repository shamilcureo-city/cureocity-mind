import type { SessionKind, SessionModality } from '@cureocity/contracts';
import type { CaptureSource } from '@/lib/audio/use-session-recorder';

/**
 * Sprint 23 — payload passed from the Record entry surface (either
 * `RecordConfirmStrip` for an existing client or `NewClientForm` for a
 * brand-new client) into the live capture / upload UI. Replaces the
 * earlier `PreFlightResult` shape (which lived in PreFlightPanel.tsx).
 *
 * `source` is included so the entry surface can choose mic vs. display
 * at confirm-time instead of forcing that choice up front.
 */
export interface RecordReady {
  sessionId: string;
  clientId: string;
  clientName: string;
  kind: SessionKind;
  modality: SessionModality | null;
  source: CaptureSource;
}

/** Consent script version baked into per-session ack rows. */
export const SCRIPT_VERSION = 'v1.0';

/**
 * Pull a clinician-readable message out of a failed API response.
 * Surfaces the first field-level Zod issue when present so a phone
 * format mismatch shows "contactPhone: must be +91 followed by exactly
 * 10 digits" instead of the generic "Validation failed".
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  type Body = {
    error?: string;
    issues?: { fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] };
  };
  const body = (await res.json().catch(() => ({}))) as Body;
  const fieldErrors = body.issues?.fieldErrors ?? {};
  for (const [field, msgs] of Object.entries(fieldErrors)) {
    if (msgs && msgs.length > 0) return `${field}: ${msgs[0]}`;
  }
  const form = body.issues?.formErrors?.[0];
  if (form) return form;
  return body.error ?? `${fallback} (${res.status})`;
}
