export type MindCaptureMode = 'LIVE' | 'BATCH';
export type MindStartSource = 'TODAY' | 'WALK_IN' | 'RECORD' | 'CLIENT';

/** A visit's current state determines its destination, not the list it appears in. */
export function mindSessionDestination(
  session: { id: string; clientId: string; status: string; captureMode?: string | null },
  defaultCapture: MindCaptureMode = 'LIVE',
): string {
  if (session.status === 'IN_PROGRESS' && session.captureMode === 'LIVE') {
    return `/app/sessions/${encodeURIComponent(session.id)}/live`;
  }
  if (session.status === 'SCHEDULED' || session.status === 'IN_PROGRESS') {
    return mindStartEntryHref({
      source: 'TODAY',
      clientId: session.clientId,
      sessionId: session.id,
      captureMode: session.status === 'IN_PROGRESS' ? 'BATCH' : defaultCapture,
    });
  }
  return `/app/sessions/${encodeURIComponent(session.id)}?tab=note`;
}

/** Never carry another client's booking or prepared-guide intent into a mutation. */
export function mindEntryContextForClient(input: {
  initialClientId: string | null;
  clientId: string;
  initialSessionId: string | null;
  initialGuideId?: string;
}): { sessionId: string | null; guideId: string | undefined } {
  return input.initialClientId === input.clientId
    ? { sessionId: input.initialSessionId, guideId: input.initialGuideId }
    : { sessionId: null, guideId: undefined };
}

export function mindStartEntryHref(input: {
  source: MindStartSource;
  clientId: string;
  sessionId?: string;
  captureMode: MindCaptureMode;
  vertical?: 'THERAPIST' | 'DOCTOR';
  doctorHref?: string;
}): string {
  if (input.vertical === 'DOCTOR') return input.doctorHref ?? '/app/clinic';
  const parts = [`record=${encodeURIComponent(input.clientId)}`];
  if (input.sessionId) parts.push(`session=${encodeURIComponent(input.sessionId)}`);
  parts.push(`capture=${input.captureMode}`);
  return `/app?${parts.join('&')}`;
}

export type StartableSession = { id: string; status: 'SCHEDULED' | 'IN_PROGRESS' };

export interface MindSessionStartInput {
  clientId: string;
  captureMode: MindCaptureMode;
  sessionId?: string;
}

export interface MindSessionStartDependencies {
  selectOrReuseSession(input: MindSessionStartInput): Promise<StartableSession>;
  resolveConsent(sessionId: string): Promise<{ sessionId: string; snapshotRecorded: boolean }>;
  runPreflight(input: {
    sessionId: string;
    captureMode: MindCaptureMode;
  }): Promise<{ ready: true } | { ready: false; reason: string }>;
  activateCapture(input: {
    sessionId: string;
    captureMode: MindCaptureMode;
  }): Promise<{ active: true } | { active: false; reason: string }>;
  /** The only operation allowed to transition SCHEDULED to IN_PROGRESS. */
  authorizeCapture(sessionId: string, captureMode: MindCaptureMode): Promise<void>;
}

export class MindSessionStartError extends Error {
  constructor(
    readonly code:
      | 'SESSION_CHANGED_DURING_CONSENT'
      | 'CONSENT_SNAPSHOT_MISSING'
      | 'PREFLIGHT_FAILED'
      | 'CAPTURE_NOT_ACTIVE',
    message: string,
  ) {
    super(message);
    this.name = 'MindSessionStartError';
  }
}

/**
 * The single Mind start sequence used by Today, Walk-in, Record and client
 * entry points.  It deliberately keeps lifecycle authorization last: a
 * scheduled session is not called in progress until capture is really active.
 */
export async function coordinateMindSessionStart(
  input: MindSessionStartInput,
  deps: MindSessionStartDependencies,
): Promise<{ sessionId: string; resumed: boolean; captureMode: MindCaptureMode }> {
  const session = await deps.selectOrReuseSession(input);
  const resumed = session.status === 'IN_PROGRESS';

  if (!resumed) {
    const consent = await deps.resolveConsent(session.id);
    if (consent.sessionId !== session.id) {
      throw new MindSessionStartError(
        'SESSION_CHANGED_DURING_CONSENT',
        'Consent must return to the session that was selected.',
      );
    }
    if (!consent.snapshotRecorded) {
      throw new MindSessionStartError(
        'CONSENT_SNAPSHOT_MISSING',
        'Confirm today’s recording consent before starting.',
      );
    }
  }

  const preflight = await deps.runPreflight({
    sessionId: session.id,
    captureMode: input.captureMode,
  });
  if (!preflight.ready) throw new MindSessionStartError('PREFLIGHT_FAILED', preflight.reason);

  const capture = await deps.activateCapture({
    sessionId: session.id,
    captureMode: input.captureMode,
  });
  if (!capture.active) throw new MindSessionStartError('CAPTURE_NOT_ACTIVE', capture.reason);

  if (!resumed) await deps.authorizeCapture(session.id, input.captureMode);
  return { sessionId: session.id, resumed, captureMode: input.captureMode };
}
