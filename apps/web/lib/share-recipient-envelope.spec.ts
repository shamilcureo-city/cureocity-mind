import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  encryptForTenant: vi.fn(
    async (_tenant: string, value: string) => `encrypted:${Buffer.from(value).toString('base64')}`,
  ),
  decryptForTenant: vi.fn(async (_tenant: string, value: string) => {
    if (!value.startsWith('encrypted:')) return null;
    try {
      return Buffer.from(value.slice('encrypted:'.length), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }),
}));

vi.mock('./tenant-crypto', () => mocks);

import {
  decryptShareRecipientEnvelope,
  encryptShareRecipientEnvelope,
} from './share-recipient-envelope';

describe('immutable share recipient envelopes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encrypts only the selected channel destination and frozen first name', async () => {
    const encrypted = await encryptShareRecipientEnvelope('psy-1', {
      channel: 'EMAIL',
      destination: 'original@example.test',
      clientFirstName: 'Original',
    });

    expect(encrypted).not.toContain('original@example.test');
    expect(mocks.encryptForTenant).toHaveBeenCalledWith(
      'psy-1',
      JSON.stringify({
        version: 1,
        channel: 'EMAIL',
        destination: 'original@example.test',
        clientFirstName: 'Original',
      }),
    );
  });

  it('fails closed for plaintext, malformed, cross-channel, and legacy envelopes', async () => {
    await expect(decryptShareRecipientEnvelope('psy-1', 'plaintext', 'EMAIL')).resolves.toBeNull();
    await expect(
      decryptShareRecipientEnvelope('psy-1', 'encrypted:{"version":1}', 'EMAIL'),
    ).resolves.toBeNull();
    await expect(
      decryptShareRecipientEnvelope(
        'psy-1',
        'encrypted:{"version":1,"channel":"WHATSAPP","destination":"+911","clientFirstName":"A"}',
        'EMAIL',
      ),
    ).resolves.toBeNull();
    await expect(decryptShareRecipientEnvelope('psy-1', null, 'EMAIL')).resolves.toBeNull();
  });

  it('round-trips a trusted channel-specific envelope', async () => {
    const encrypted = await encryptShareRecipientEnvelope('psy-1', {
      channel: 'WHATSAPP',
      destination: '+919999999999',
      clientFirstName: 'Asha',
    });
    await expect(decryptShareRecipientEnvelope('psy-1', encrypted, 'WHATSAPP')).resolves.toEqual({
      version: 1,
      channel: 'WHATSAPP',
      destination: '+919999999999',
      clientFirstName: 'Asha',
    });
  });
});
