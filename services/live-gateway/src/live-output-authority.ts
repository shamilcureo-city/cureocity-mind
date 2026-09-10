import type { LiveGatewayEvent } from '@cureocity/contracts';
import type { LiveAuthority } from './live-authority';
import type { LiveSession } from './live-session';

/** Run at the head of the ordered output queue, immediately before socket send.
 * The authority request itself may revoke background or overlap a new review.
 * Check the original event's private epoch only after that request has settled.
 */
export async function authorizeLiveSessionOutput(
  event: LiveGatewayEvent,
  authority: Pick<LiveAuthority, 'authorizeEvent'> | null,
  origin: Pick<LiveSession, 'isTherapyOutputCurrent'> | null,
): Promise<LiveGatewayEvent | null> {
  const authorized = authority ? await authority.authorizeEvent(event) : event;
  if (!authorized || (origin && !origin.isTherapyOutputCurrent(event))) return null;
  return authorized;
}
