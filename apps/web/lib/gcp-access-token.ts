import { createSign } from 'node:crypto';

/**
 * Mint a short-lived GCP OAuth2 access token from the platform service
 * account (`GOOGLE_APPLICATION_CREDENTIALS_JSON`) via the JWT-bearer flow —
 * dependency-free (node:crypto + fetch), the same approach as
 * `gcp-kms-rest.ts`. No gRPC SDK, no `google-auth-library`, no new credential.
 *
 * Used by the Vertex Live backend (`CARE_LIVE_BACKEND=vertex`) to mint the
 * `cloud-platform`-scoped token the browser presents to the Vertex Live
 * socket. NOTE the scope is broad (Vertex has no narrower scope than
 * cloud-platform); the token is short-lived and its exposure is bounded to a
 * single session — see the security note in `docs/runbooks/care.md`.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
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
      'A Vertex/GCP feature needs GOOGLE_APPLICATION_CREDENTIALS_JSON (the service-account key JSON).',
    );
  }
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is missing client_email / private_key.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
  };
}

/** The GCP project id — `VERTEX_PROJECT_ID` wins, else the SA's `project_id`. */
export function gcpProjectId(): string {
  const explicit = process.env['VERTEX_PROJECT_ID'];
  if (explicit) return explicit;
  const id = serviceAccount().project_id;
  if (!id) {
    throw new Error(
      'No VERTEX_PROJECT_ID and no project_id in GOOGLE_APPLICATION_CREDENTIALS_JSON.',
    );
  }
  return id;
}

/** Per-scope token cache — one warm instance reuses tokens until near expiry. */
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

export interface GcpAccessToken {
  token: string;
  /** Unix ms the token expires at. */
  expiresAtMs: number;
}

export async function mintGcpAccessToken(
  scope = 'https://www.googleapis.com/auth/cloud-platform',
): Promise<GcpAccessToken> {
  const now = Date.now();
  const cached = tokenCache.get(scope);
  // 60s skew guard so we never present a token about to expire mid-connect.
  if (cached && cached.expiresAtMs - 60_000 > now) {
    return { token: cached.token, expiresAtMs: cached.expiresAtMs };
  }

  const sa = serviceAccount();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
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
  const expiresAtMs = now + body.expires_in * 1000;
  tokenCache.set(scope, { token: body.access_token, expiresAtMs });
  return { token: body.access_token, expiresAtMs };
}
