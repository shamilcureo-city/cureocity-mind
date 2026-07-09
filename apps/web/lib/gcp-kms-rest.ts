import { createSign } from 'node:crypto';
import type { GcpKmsClient } from '@cureocity/crypto';

/**
 * Sprint 32 Phase 2 — Google Cloud KMS via the REST API, dependency-free.
 *
 * We deliberately DON'T use @google-cloud/kms: it is gRPC-based (google-gax +
 * native protobufs) and bundles poorly in Next.js serverless functions. The
 * REST surface is pure `fetch`, so it works cleanly on Vercel and adds zero
 * dependencies. Auth reuses the SAME service account already configured for
 * Vertex (`GOOGLE_APPLICATION_CREDENTIALS_JSON`) — no new credential to manage.
 *
 * A self-signed JWT (RS256, via node:crypto) is exchanged at Google's OAuth
 * token endpoint for a short-lived access token, cached in module scope for
 * the life of a warm function instance. This adapter satisfies the SDK-free
 * `GcpKmsClient` port that `GcpKmsProvider` (in @cureocity/crypto) consumes.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function serviceAccount(): ServiceAccount {
  const raw = process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON'];
  if (!raw) {
    throw new Error(
      'KMS_BACKEND=gcp-kms requires GOOGLE_APPLICATION_CREDENTIALS_JSON (the service-account key JSON).',
    );
  }
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is missing client_email / private_key.');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

let tokenCache: { token: string; expiresAtMs: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Date.now();
  // 60s skew guard so we never present a token about to expire mid-call.
  if (tokenCache && tokenCache.expiresAtMs - 60_000 > now) return tokenCache.token;

  const sa = serviceAccount();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloudkms',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = base64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`GCP access-token mint failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAtMs: now + body.expires_in * 1000 };
  return body.access_token;
}

async function kmsCall(
  keyName: string,
  op: 'encrypt' | 'decrypt',
  payloadKey: 'plaintext' | 'ciphertext',
  bytes: Buffer,
): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const res = await fetch(`https://cloudkms.googleapis.com/v1/${keyName}:${op}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ [payloadKey]: bytes.toString('base64') }),
  });
  if (!res.ok) {
    throw new Error(`Cloud KMS ${op} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** A GcpKmsClient backed by the Cloud KMS REST API. base64 in/out — the
 *  provider's toBuffer() decodes the base64 strings this returns. */
export function gcpKmsRestClient(): GcpKmsClient {
  return {
    encrypt: async ({ name, plaintext }) => {
      const body = await kmsCall(name, 'encrypt', 'plaintext', plaintext);
      return { ciphertext: (body['ciphertext'] as string | undefined) ?? null };
    },
    decrypt: async ({ name, ciphertext }) => {
      const body = await kmsCall(name, 'decrypt', 'ciphertext', Buffer.from(ciphertext));
      return { plaintext: (body['plaintext'] as string | undefined) ?? null };
    },
  };
}
