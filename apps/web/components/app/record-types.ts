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
