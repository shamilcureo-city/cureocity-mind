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
  vercelPolicyInput,
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
  /// CP2 (flagged: CARE_LIVE_STRUCTURE) — include the mark_phase tool in the
  /// setup and echo `structure: true` back so the client renders the rail.
  structure?: boolean;
}

/**
 * The platform's no-mock-on-deploy rule (CLAUDE.md §7), applied to the Care
 * live mint — the one LLM-serving path that used to bypass it. Unset or
 * 'mock' CARE_LIVE_BACKEND on a deployed environment used to hand real D2C
 * users a ws://localhost:8788 credential: a dead session that still burned
 * their weekly cap. Same environment semantics as the batch pipeline
 * (`vercelPolicyInput`): refused in production always; refused on previews
 * unless ALLOW_MOCK_LLM=true; open locally.
 *
 * Returns the refusal message, or null when this environment may serve the
 * resolved backend. Call it BEFORE creating a CareSession row.
 */
export function careLiveMockRefusalReason(): string | null {
  const backend = process.env['CARE_LIVE_BACKEND'] ?? 'mock';
  if (backend === 'vertex' || backend === 'ai-studio') return null;
  const env = vercelPolicyInput(process.env);
  if (env.production) {
    return (
      `[care] REFUSING the mock live backend in PRODUCTION (CARE_LIVE_BACKEND='${backend}'). ` +
      `A fabricated AI-therapist session must never reach a real user — set ` +
      `CARE_LIVE_BACKEND=vertex or ai-studio with credentials.`
    );
  }
  if (env.deployed && !env.allowMockOptIn) {
    return (
      `[care] REFUSING the mock live backend on a deployed environment ` +
      `(CARE_LIVE_BACKEND='${backend}'). Set CARE_LIVE_BACKEND=vertex/ai-studio, or ` +
      `ALLOW_MOCK_LLM=true to deliberately permit a NON-production demo.`
    );
  }
  return null;
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
    phaseTool: input.structure,
  });

  if (backend === 'mock') {
    // Backstop for callers that skipped the route-level check — never serve
    // a localhost credential from a deployed environment.
    const refusal = careLiveMockRefusalReason();
    if (refusal) throw new Error(refusal);
    return {
      mode: 'mock',
      wsUrl: process.env['CARE_MOCK_LIVE_URL'] ?? 'ws://localhost:8788',
      setup,
      expiresAtMs,
      ...(input.structure ? { structure: true as const } : {}),
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
        ...(input.structure ? { structure: true as const } : {}),
      };
    } catch (e) {
      // On a DEPLOYED environment the old "availability beats purity"
      // fallback traded one failed session for handing the LONG-LIVED
      // GEMINI_API_KEY to the user's browser (extractable from devtools).
      // Fail closed there: the user retries; the key stays server-side.
      // Local dev keeps the fallback so a flaky v1alpha endpoint doesn't
      // block development.
      if (vercelPolicyInput(process.env).deployed) {
        throw new Error(
          `[care] ephemeral auth-token mint failed (${(e as Error).message}) — ` +
            `refusing the url-mode fallback on a deployed environment because it embeds ` +
            `the long-lived GEMINI_API_KEY in the browser URL. The session was not started; ` +
            `retry, or set CARE_LIVE_TOKEN_MODE=url only as a deliberate operator decision.`,
        );
      }
      console.error(
        `[care] ephemeral auth-token mint failed (${(e as Error).message}) — falling back to url mode for this session (local dev only)`,
      );
    }
  } else if (tokenMode === 'url' && vercelPolicyInput(process.env).deployed) {
    // Explicit operator opt-in still works, but never silently.
    console.warn(
      '[care] CARE_LIVE_TOKEN_MODE=url on a deployed environment — the GEMINI_API_KEY is being embedded in browser WSS URLs. Rotate the key and switch to ephemeral as soon as possible.',
    );
  }

  return {
    mode: 'url',
    wsUrl: `${CARE_LIVE_WSS_BASE}?key=${encodeURIComponent(apiKey)}`,
    setup,
    expiresAtMs,
    ...(input.structure ? { structure: true as const } : {}),
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
    phaseTool: input.structure,
  });

  return {
    mode: 'vertex',
    wsUrl: `${careVertexWssBase(location)}?access_token=${encodeURIComponent(token)}`,
    accessToken: token,
    setup,
    expiresAtMs: Math.min(sessionExpiresAtMs, tokenExpiresAtMs),
    ...(input.structure ? { structure: true as const } : {}),
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
