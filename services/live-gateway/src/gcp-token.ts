import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Sprint DS13 — mint a cloud-platform GCP access token for the gateway's
 * streaming-transcript socket, dependency-free (node:crypto + fetch), the
 * same JWT-bearer approach as apps/web/lib/gcp-access-token.ts.
 *
 * Resolution order matches how the gateway actually deploys:
 *   1. Cloud Run metadata server (the runtime service account) — no key file.
 *   2. GOOGLE_APPLICATION_CREDENTIALS_JSON (inline SA key, local/dev).
 *   3. GOOGLE_APPLICATION_CREDENTIALS (path to an SA key file — what the
 *      Vertex SDK backends already use).
 */

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface GcpAccessToken {
  token: string;
  /** Unix ms the token expires at. */
  expiresAtMs: number;
}

let cached: GcpAccessToken | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function loadServiceAccount(): ServiceAccount | null {
  const inline = process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON'];
  const path = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  let raw: string | null = null;
  if (inline) raw = inline;
  else if (path) {
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(parsed.project_id !== undefined && { project_id: parsed.project_id }),
    };
  } catch {
    return null;
  }
}

/** The GCP project id — `VERTEX_PROJECT_ID` wins, else the SA key's. */
export function gatewayGcpProjectId(): string | null {
  return process.env['VERTEX_PROJECT_ID'] ?? loadServiceAccount()?.project_id ?? null;
}

async function fromMetadataServer(fetcher: typeof fetch): Promise<GcpAccessToken | null> {
  try {
    const res = await fetcher(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    return { token: body.access_token, expiresAtMs: Date.now() + (body.expires_in ?? 300) * 1000 };
  } catch {
    return null; // not on GCP — fall through to the key-based flow
  }
}

async function fromServiceAccount(fetcher: typeof fetch): Promise<GcpAccessToken | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;
  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = base64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const res = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`GCP access-token mint failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { token: body.access_token, expiresAtMs: now + body.expires_in * 1000 };
}

/**
 * A cached cloud-platform token (60s expiry skew). Returns null when no
 * credential source is available — callers treat that as "streaming rail
 * unavailable", never a crash.
 */
export async function gatewayAccessToken(
  fetcher: typeof fetch = fetch,
): Promise<GcpAccessToken | null> {
  const now = Date.now();
  if (cached && cached.expiresAtMs - 60_000 > now) return cached;
  const token = (await fromMetadataServer(fetcher)) ?? (await fromServiceAccount(fetcher));
  cached = token;
  return token;
}

/** Test hook — drop the cached token. */
export function resetGatewayTokenCache(): void {
  cached = null;
}
