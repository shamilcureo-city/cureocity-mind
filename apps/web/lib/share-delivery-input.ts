import { ShareInputSchema, type ShareInput } from '@cureocity/contracts';

/** Validate the exact body used by direct, side-effecting share callers. */
export function buildShareDeliveryInput(input: unknown): ShareInput {
  return ShareInputSchema.parse(input);
}
