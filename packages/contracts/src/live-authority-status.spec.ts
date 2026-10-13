import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveGatewayEventSchema, LiveGatewayStateSchema } from './live-encounter';

describe('live authority failure status compatibility', () => {
  it.each(['denied', 'unavailable'] as const)(
    'preserves the %s reason for current clients',
    (reason) => {
      const event = { type: 'status', state: 'unauthorized', authorizationReason: reason };
      expect(LiveGatewayEventSchema.parse(event)).toEqual(event);
      // Previous web releases parse status with only these two fields. Sending a
      // new state instead would make them ignore the failure and leave capture on.
      const previousStatusSchema = z.object({
        type: z.literal('status'),
        state: LiveGatewayStateSchema,
      });
      expect(previousStatusSchema.parse(event)).toEqual({ type: 'status', state: 'unauthorized' });
    },
  );

  it('keeps a legacy unspecified failure denied rather than guessing it is temporary', () => {
    expect(LiveGatewayEventSchema.parse({ type: 'status', state: 'unauthorized' })).toEqual({
      type: 'status',
      state: 'unauthorized',
    });
  });

  it('discards unknown detail without ignoring the stop-capture status', () => {
    expect(
      LiveGatewayEventSchema.parse({
        type: 'status',
        state: 'unauthorized',
        authorizationReason: 'future-reason',
      }),
    ).toEqual({ type: 'status', state: 'unauthorized', authorizationReason: undefined });
  });
});
