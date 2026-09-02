import type { PatientShareChannel } from '@cureocity/contracts';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';

export interface ShareRecipientEnvelopeV1 {
  version: 1;
  channel: PatientShareChannel;
  destination: string | null;
  clientFirstName: string;
}

export async function encryptShareRecipientEnvelope(
  psychologistId: string,
  envelope: Omit<ShareRecipientEnvelopeV1, 'version'>,
): Promise<string> {
  return encryptForTenant(psychologistId, JSON.stringify({ version: 1, ...envelope }));
}

export async function decryptShareRecipientEnvelope(
  psychologistId: string,
  encrypted: string | null | undefined,
  expectedChannel: PatientShareChannel,
): Promise<ShareRecipientEnvelopeV1 | null> {
  if (!encrypted) return null;
  const plaintext = await decryptForTenant(psychologistId, encrypted);
  if (!plaintext) return null;
  try {
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (
      value['version'] !== 1 ||
      value['channel'] !== expectedChannel ||
      typeof value['clientFirstName'] !== 'string' ||
      (value['destination'] !== null && typeof value['destination'] !== 'string')
    ) {
      return null;
    }
    return {
      version: 1,
      channel: expectedChannel,
      destination: value['destination'] as string | null,
      clientFirstName: value['clientFirstName'],
    };
  } catch {
    return null;
  }
}
