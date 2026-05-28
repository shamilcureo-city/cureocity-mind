import type { IKmsProvider, UnwrappedDataKey, WrappedDataKey } from '../types';

/**
 * AwsKmsProvider — production KMS using AWS KMS GenerateDataKey + Decrypt.
 *
 * Loaded lazily because @aws-sdk/client-kms is a transitive (workspace
 * services that need it depend on it directly). Constructor takes the
 * already-instantiated KMSClient so test substitutes don't need network.
 *
 * KMSClient is typed structurally here to avoid pulling the SDK type
 * surface into @cureocity/crypto's own types. The shape matches the
 * real client.
 */
interface AwsKmsClient {
  send(command: AwsKmsCommand): Promise<AwsKmsResponse>;
}
interface AwsKmsCommand {
  input: Record<string, unknown>;
  /** Discriminator the AWS SDK serializes; we read it for routing in tests. */
  constructor: { name: string };
}
interface AwsKmsResponse {
  KeyId?: string;
  Plaintext?: Uint8Array;
  CiphertextBlob?: Uint8Array;
}

export class AwsKmsProvider implements IKmsProvider {
  constructor(
    private readonly client: AwsKmsClient,
    private readonly cmkKeyId: string,
    /** Factory for the SDK command objects; injected so tests don't need the SDK. */
    private readonly commands: {
      generateDataKey: (input: { KeyId: string; KeySpec: 'AES_256' }) => AwsKmsCommand;
      decrypt: (input: { CiphertextBlob: Uint8Array; KeyId?: string }) => AwsKmsCommand;
    },
  ) {}

  async generateDataKey(): Promise<{ wrapped: WrappedDataKey; plaintext: UnwrappedDataKey }> {
    const res = await this.client.send(
      this.commands.generateDataKey({ KeyId: this.cmkKeyId, KeySpec: 'AES_256' }),
    );
    if (!res.Plaintext || !res.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned no Plaintext/CiphertextBlob');
    }
    const keyId = res.KeyId ?? this.cmkKeyId;
    return {
      wrapped: {
        keyId,
        wrappedKey: Buffer.from(res.CiphertextBlob).toString('base64'),
      },
      plaintext: {
        keyId,
        key: new Uint8Array(res.Plaintext),
      },
    };
  }

  async unwrapDataKey(wrapped: WrappedDataKey): Promise<UnwrappedDataKey> {
    const res = await this.client.send(
      this.commands.decrypt({
        CiphertextBlob: Buffer.from(wrapped.wrappedKey, 'base64'),
        KeyId: wrapped.keyId,
      }),
    );
    if (!res.Plaintext) throw new Error('KMS Decrypt returned no Plaintext');
    return {
      keyId: res.KeyId ?? wrapped.keyId,
      key: new Uint8Array(res.Plaintext),
    };
  }
}
