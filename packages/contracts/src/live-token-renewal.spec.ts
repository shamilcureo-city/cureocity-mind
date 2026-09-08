import { describe, expect, it } from 'vitest';
import { LiveGatewayCommandSchema, LiveGatewayEventSchema } from './live-encounter';

const requestId = 'd1d9c73e-ef13-4d38-956c-c5d49572b9be';

describe('in-place live token renewal protocol', () => {
  it('accepts a bounded correlated renewal command and acknowledgement', () => {
    expect(
      LiveGatewayCommandSchema.safeParse({ type: 'renewToken', requestId, token: 'signed-token' })
        .success,
    ).toBe(true);
    expect(
      LiveGatewayEventSchema.safeParse({
        type: 'tokenRenewed',
        requestId,
        expiresAt: 1_800_000_000,
      }).success,
    ).toBe(true);
  });

  it.each(['', 'not-a-uuid', undefined])(
    'rejects uncorrelated requests and acknowledgements (%s)',
    (badId) => {
      expect(
        LiveGatewayCommandSchema.safeParse({
          type: 'renewToken',
          requestId: badId,
          token: 'signed-token',
        }).success,
      ).toBe(false);
      expect(
        LiveGatewayEventSchema.safeParse({
          type: 'tokenRenewed',
          requestId: badId,
          expiresAt: 1_800_000_000,
        }).success,
      ).toBe(false);
    },
  );

  it.each(['', 'x'.repeat(8193), undefined])(
    'rejects missing or oversized renewal tokens %#',
    (token) => {
      expect(
        LiveGatewayCommandSchema.safeParse({ type: 'renewToken', requestId, token }).success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expiry %s',
    (expiresAt) => {
      expect(
        LiveGatewayEventSchema.safeParse({ type: 'tokenRenewed', requestId, expiresAt }).success,
      ).toBe(false);
    },
  );

  it('keeps existing start, pause and stop protocol compatibility', () => {
    expect(
      LiveGatewayCommandSchema.safeParse({
        type: 'start',
        sessionId: 'session',
        token: 'signed-token',
      }).success,
    ).toBe(true);
    expect(LiveGatewayCommandSchema.safeParse({ type: 'pause', requestId }).success).toBe(true);
    expect(LiveGatewayCommandSchema.safeParse({ type: 'stop' }).success).toBe(true);
  });
});
