import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyShareDelivery,
  canOrdinarilyResend,
  careHomeShareHref,
} from './sprint5-final-behavior';
import { enforceSameOriginMutation } from './same-origin-mutation';

describe('Sprint 5 latest blocker behavior', () => {
  it('replayably erases historical plaintext recipient fields at migration cutover', () => {
    const sql = readFileSync(
      join(
        import.meta.dirname,
        '../../../prisma/migrations/20260923000000_sprint5_provenance_envelopes/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/SET "toContact" = NULL,\s+"recipientEnvelope" = NULL/);
    expect(sql).toContain('WHERE "toContact" IS NOT NULL OR "recipientEnvelope" IS NOT NULL');
  });
  it.each(['WATI_NETWORK', 'SENDGRID_NETWORK', 'DELIVERY_EXCEPTION', 'WATI_500', 'SENDGRID_503'])(
    'terminalizes ambiguous provider result %s and forbids ordinary resend',
    (errorCode) => {
      const result = classifyShareDelivery({ outcome: 'transient_failure', errorCode });
      expect(result).toEqual({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
      });
      expect(canOrdinarilyResend(result)).toBe(false);
    },
  );

  it('permits retry only after verified non-delivery', () => {
    expect(
      canOrdinarilyResend({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
        verifiedNonDeliveryAt: new Date(),
      }),
    ).toBe(true);
  });

  it('never emits an expired portal token from care home', () => {
    expect(careHomeShareHref('share-1', 'expired-token', new Date(0), new Date(1))).toBe(
      '/p/home?refresh=share-1',
    );
    expect(careHomeShareHref('share-2', 'active-token', new Date(2), new Date(1))).toBe(
      '/p/active-token',
    );
  });

  it('allows normal same-origin browser mutations and bearer clients', () => {
    expect(
      enforceSameOriginMutation(
        new Request('https://mind.example/api/v1/share', {
          method: 'POST',
          headers: { origin: 'https://mind.example', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBeNull();
    expect(
      enforceSameOriginMutation(
        new Request('https://mind.example/api/v1/share', {
          method: 'POST',
          headers: { authorization: 'Bearer token' },
        }),
      ),
    ).toBeNull();
  });

  it('rejects cross-site and mismatched-origin cookie mutations', async () => {
    for (const headers of [
      new Headers({ cookie: '__session=x', 'sec-fetch-site': 'cross-site' }),
      new Headers({ cookie: '__session=x', origin: 'https://evil.example' }),
    ]) {
      const response = enforceSameOriginMutation(
        new Request('https://mind.example/api/v1/share', {
          method: 'POST',
          headers,
        }),
      );
      expect(response?.status).toBe(403);
      expect(await response?.json()).toEqual({ error: 'Cross-site mutation blocked' });
    }
  });
});
