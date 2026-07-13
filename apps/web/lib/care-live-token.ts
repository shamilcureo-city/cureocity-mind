import { GoogleGenAI } from '@google/genai';
import {
  buildCareLiveSetup,
  CARE_LIVE_MODEL_ID,
  CARE_LIVE_VERTEX_LOCATION_DEFAULT,
  CARE_LIVE_VERTEX_MODEL_DEFAULT,
  CARE_LIVE_WSS_BASE,
  careVertexModelPath,
  careVertexWssBase,
  clampVadSilence,
} from '@cureocity/llm';
import type { RedeemLiveTokenResponse } from '@cureocity/contracts';
import { gcpProjectId, mintGcpAccessToken } from './gcp-access-token';

/**
 * Cureocity Care — the live-credential mint (AC3, §4.2 steps 4-5).
 *
 * Backends (CARE_LIVE_BACKEND):
 *   mock       — points at services/care-mock-live (dev/CI default).
 *   ai-studio  — Gemini Live on the v1beta AI Studio endpoint. Credential
 *                modes (CARE_LIVE_TOKEN_MODE):
 *                  ephemeral (default) — v1alpha auth_tokens.create; the
 *                    long-lived API key NEVER reaches the browser.
 *                  url — the source recipe's fallback: full WSS URL with
 *                    the key embedded. Behind the flag, never the default.
 *   vertex     — Vertex AI Live (LlmBidiService) in-region on the platform
 *                service account (no separate API key; DPDP posture). The
 *                browser opens the Vertex WSS with a short-lived
 *                cloud-platform GCP token; region + model are env-tunable
 *                (CARE_LIVE_VERTEX_LOCATION / _MODEL — run the probe script to
 *                discover the working pair). SECURITY: the browser receives a
 *                broad cloud-platform token (Vertex has no narrower scope);
 *                it is short-lived and single-session — see docs/runbooks/care.md.
 *
 * If the ephemeral-token API call fails (API drift, quota, project not
 * allowlisted) we log and fall back to `url` mode so a session can still
 * start — availability beats purity for a support product; the fallback
 * is visible in logs and in the response's `mode`.
 */

export interface MintLiveCredentialInput {
  voiceName: string;
  vadSilenceMs: number;
  systemInstruction: string;
  sessionCapMin: number;
}

export async function mintLiveCredential(
  input: MintLiveCredentialInput,
): Promise<RedeemLiveTokenResponse> {
  const backend = process.env['CARE_LIVE_BACKEND'] ?? 'mock';
  const expiresAtMs = Date.now() + input.sessionCapMin * 60_000;
  const setup = buildCareLiveSetup({
    voiceName: input.voiceName,
    vadSilenceMs: clampVadSilence(input.vadSilenceMs),
    systemInstruction: input.systemInstruction,
  });

  if (backend === 'mock') {
    return {
      mode: 'mock',
      wsUrl: process.env['CARE_MOCK_LIVE_URL'] ?? 'ws://localhost:8788',
      setup,
      expiresAtMs,
    };
  }

  if (backend === 'vertex') {
    return await mintVertexCredential(input, expiresAtMs);
  }

  if (backend !== 'ai-studio') {
    throw new Error(`CARE_LIVE_BACKEND=${backend} is not wired (mock | ai-studio | vertex).`);
  }

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('CARE_LIVE_BACKEND=ai-studio requires GEMINI_API_KEY');
  }

  const tokenMode = process.env['CARE_LIVE_TOKEN_MODE'] ?? 'ephemeral';
  if (tokenMode === 'ephemeral') {
    try {
      const token = await createEphemeralToken(apiKey, input.sessionCapMin);
      return {
        mode: 'ephemeral',
        wsUrl: `${CARE_LIVE_WSS_BASE}?access_token=${encodeURIComponent(token)}`,
        accessToken: token,
        expiresAtMs,
        // Shipped until the locked-constraints flow is probe-verified
        // (AC0 exit criterion) — then this field is dropped and the
        // system prompt never leaves the server.
        setup,
      };
    } catch (e) {
      console.error(
        `[care] ephemeral auth-token mint failed (${(e as Error).message}) — falling back to url mode for this session`,
      );
    }
  }

  return {
    mode: 'url',
    wsUrl: `${CARE_LIVE_WSS_BASE}?key=${encodeURIComponent(apiKey)}`,
    setup,
    expiresAtMs,
  };
}

/**
 * Vertex AI Live credential: mint a cloud-platform GCP access token from the
 * platform service account, target the regional LlmBidiService socket, and
 * carry the full model resource path in the setup. Browser-direct — the same
 * shape the client already handles (wsUrl + setup). The credential expires at
 * the earlier of the session cap and the GCP token, so the browser never
 * holds a usable token past the session.
 */
async function mintVertexCredential(
  input: MintLiveCredentialInput,
  sessionExpiresAtMs: number,
): Promise<RedeemLiveTokenResponse> {
  const project = gcpProjectId();
  const location = process.env['CARE_LIVE_VERTEX_LOCATION'] ?? CARE_LIVE_VERTEX_LOCATION_DEFAULT;
  const model = process.env['CARE_LIVE_VERTEX_MODEL'] ?? CARE_LIVE_VERTEX_MODEL_DEFAULT;

  const { token, expiresAtMs: tokenExpiresAtMs } = await mintGcpAccessToken();

  const setup = buildCareLiveSetup({
    voiceName: input.voiceName,
    vadSilenceMs: clampVadSilence(input.vadSilenceMs),
    systemInstruction: input.systemInstruction,
    model: careVertexModelPath(project, location, model),
  });

  return {
    mode: 'vertex',
    wsUrl: `${careVertexWssBase(location)}?access_token=${encodeURIComponent(token)}`,
    accessToken: token,
    setup,
    expiresAtMs: Math.min(sessionExpiresAtMs, tokenExpiresAtMs),
  };
}

/**
 * v1alpha ephemeral auth token: single use, short connect window, TTL =
 * the session cap. Uses the @google/genai SDK when it exposes authTokens
 * (SDK ≥ 1.x), with a raw REST fallback for older SDKs.
 */
async function createEphemeralToken(apiKey: string, capMin: number): Promise<string> {
  const expireTime = new Date(Date.now() + capMin * 60_000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60_000).toISOString();

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  const authTokens = (
    ai as unknown as {
      authTokens?: {
        create(args: { config: Record<string, unknown> }): Promise<{ name?: string }>;
      };
    }
  ).authTokens;

  if (authTokens) {
    const token = await authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: { model: CARE_LIVE_MODEL_ID },
      },
    });
    if (token.name) return token.name;
    throw new Error('auth_tokens.create returned no token name');
  }

  // REST fallback for SDKs without authTokens support.
  const res = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: { model: CARE_LIVE_MODEL_ID },
    }),
  });
  if (!res.ok) {
    throw new Error(`auth_tokens REST create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { name?: string };
  if (!body.name) throw new Error('auth_tokens REST create returned no token name');
  return body.name;
}
