import type { LiveGatewayEvent } from '@cureocity/contracts';
import type { LiveAuthority } from './live-authority';
import type { LiveSession } from './live-session';

export interface LiveOutputEntry {
  event: LiveGatewayEvent;
  origin: Pick<LiveSession, 'isTherapyOutputCurrent'> | null;
}

/** Send only pre-existing queued entries after their fresh shared check.
 * Keep the private review epoch check at the actual synchronous send boundary.
 */
export async function forwardLiveSessionOutputBatch(
  batch: readonly LiveOutputEntry[],
  authority: Pick<LiveAuthority, 'authorizeEventBatch'> | null,
  send: (event: LiveGatewayEvent, index: number) => void,
): Promise<void> {
  const forward = (authorized: LiveGatewayEvent, index: number): void => {
    const entry = batch[index];
    if (!entry || (entry.origin && !entry.origin.isTherapyOutputCurrent(entry.event))) return;
    send(authorized, index);
  };
  const events = batch.map(({ event }) => event);
  if (authority) await authority.authorizeEventBatch(events, forward);
  else events.forEach(forward);
}

/** Run at the head of the ordered output queue, immediately before socket send.
 * The authority request itself may revoke background or overlap a new review.
 * Check the original event's private epoch only after that request has settled.
 */
export async function authorizeLiveSessionOutput(
  event: LiveGatewayEvent,
  authority: Pick<LiveAuthority, 'authorizeEventBatch'> | null,
  origin: Pick<LiveSession, 'isTherapyOutputCurrent'> | null,
): Promise<LiveGatewayEvent | null> {
  let authorized: LiveGatewayEvent | null = null;
  await forwardLiveSessionOutputBatch([{ event, origin }], authority, (output) => {
    authorized = output;
  });
  return authorized;
}
