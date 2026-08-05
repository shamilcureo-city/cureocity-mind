import { AccessToken } from 'livekit-server-sdk';

/**
 * MK9 — Cureocity Sessions: in-app 1:1 video on LiveKit Cloud.
 *
 * Env (all three or the feature is off and the therapist's own
 * Meet/Zoom link keeps being used everywhere):
 *   LIVEKIT_URL        wss://<project>.livekit.cloud
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 *
 * DPDP posture: tokens carry NO patient identity — the patient joins as
 * identity "patient", display name "Client". Media relays through
 * LiveKit's SFU encrypted in transit and is never recorded server-side
 * in V1 (the scribe merge captures audio client-side, with consent, in
 * a later sprint).
 */

export function livekitConfigured(): boolean {
  return Boolean(
    process.env['LIVEKIT_URL'] &&
    process.env['LIVEKIT_API_KEY'] &&
    process.env['LIVEKIT_API_SECRET'],
  );
}

export function livekitUrl(): string {
  return process.env['LIVEKIT_URL'] ?? '';
}

/** One room per appointment. */
export function roomNameFor(appointmentId: string): string {
  return `appt_${appointmentId}`;
}

/** VS1 — one room per SESSION (the Record screen's ad-hoc Virtual option). */
export function sessionRoomNameFor(sessionId: string): string {
  return `sess_${sessionId}`;
}

/**
 * The join window: 30 minutes before the slot opens the doors; they
 * stay open until an hour past its end (sessions overrun). Outside the
 * window the token routes refuse, so a leaked link is time-bounded.
 */
export function withinJoinWindow(startAt: Date, endAt: Date, now: Date): boolean {
  const opens = startAt.getTime() - 30 * 60_000;
  const closes = endAt.getTime() + 60 * 60_000;
  return now.getTime() >= opens && now.getTime() <= closes;
}

export async function mintVideoToken(
  appointmentId: string,
  role: 'therapist' | 'patient',
  displayName: string,
): Promise<string> {
  return mintRoomToken(roomNameFor(appointmentId), role, displayName);
}

/** VS1 — the appointment mint, generalised so session rooms share it. */
export async function mintRoomToken(
  roomName: string,
  role: 'therapist' | 'patient',
  displayName: string,
): Promise<string> {
  const at = new AccessToken(process.env['LIVEKIT_API_KEY']!, process.env['LIVEKIT_API_SECRET']!, {
    identity: role,
    name: displayName,
    // Long enough to cover a session + overrun; the status/window checks in
    // the token routes are the real gate on when a token can be minted.
    ttl: '3h',
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}
