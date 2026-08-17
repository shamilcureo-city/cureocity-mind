import { GoogleAuth } from 'google-auth-library';
import type { GcpKmsTransport } from '@cureocity/crypto';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Cloud KMS REST transport using ADC or GOOGLE_APPLICATION_CREDENTIALS_JSON. */
export class GoogleCloudKmsTransport implements GcpKmsTransport {
  private readonly auth: GoogleAuth;

  constructor(credentialsJson = process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON']) {
    let credentials: Record<string, unknown> | undefined;
    if (credentialsJson) {
      credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
      if (typeof credentials['private_key'] === 'string') {
        credentials['private_key'] = credentials['private_key'].replace(/\\n/g, '\n');
      }
    }
    this.auth = new GoogleAuth({
      scopes: [CLOUD_PLATFORM_SCOPE],
      ...(credentials && { credentials }),
    });
  }

  async encrypt(keyName: string, plaintextBase64: string): Promise<string> {
    const client = await this.auth.getClient();
    const response = await client.request<{ ciphertext?: string }>({
      url: `https://cloudkms.googleapis.com/v1/${keyName}:encrypt`,
      method: 'POST',
      data: { plaintext: plaintextBase64 },
    });
    if (!response.data.ciphertext)
      throw new Error('Google Cloud KMS encrypt returned no ciphertext');
    return response.data.ciphertext;
  }

  async decrypt(keyName: string, ciphertextBase64: string): Promise<string> {
    const client = await this.auth.getClient();
    const response = await client.request<{ plaintext?: string }>({
      url: `https://cloudkms.googleapis.com/v1/${keyName}:decrypt`,
      method: 'POST',
      data: { ciphertext: ciphertextBase64 },
    });
    if (!response.data.plaintext) throw new Error('Google Cloud KMS decrypt returned no plaintext');
    return response.data.plaintext;
  }
}
