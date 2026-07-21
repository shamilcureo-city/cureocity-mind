/**
 * Cureocity Care — Gemini Live wire constants (docs/AI_COUNSELING.md §4).
 *
 * Every hard-won number from the battle-tested source recipe lives HERE and
 * nowhere else: the dated model pin, the probe-verified voice set, the VAD
 * tuning, and the audio formats. The web token-mint route, the AC0 probe
 * script, and services/care-mock-live all import from this file so they can
 * never drift apart.
 */

/**
 * DATED PIN — never `-latest`. Alias rotation caused two production outages
 * in the source project. Rotate deliberately via scripts/live-probe.ts.
 *
 * ❌ Do NOT use `gemini-3.1-flash-live-preview`: setup is accepted, then the
 * WS drops mid-conversation (audio-streaming/VAD-runtime suspect). Re-probe
 * before ever adopting it.
 */
export const CARE_LIVE_MODEL_ID = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

/// Probe-verified prebuilt voices. The persona picker maps onto these.
export const CARE_LIVE_VOICES = ['Puck', 'Kore', 'Charon', 'Aoede'] as const;
export type CareLiveVoice = (typeof CARE_LIVE_VOICES)[number];

/**
 * §4.4 VAD — therapy needs longer silences than coaching. Keep START HIGH +
 * END LOW (flip END to HIGH and the AI talks over a thinking/crying user).
 * 400 ms is the source recipe's coaching floor; 700 ms is the therapy
 * default; per-user tunable up to 1200 ("give me more time to think").
 */
export const CARE_VAD_DEFAULT_SILENCE_MS = 700;
export const CARE_VAD_MIN_SILENCE_MS = 400;
export const CARE_VAD_MAX_SILENCE_MS = 1200;

/// Audio formats — exact, or Gemini rejects/garbles (§4.5).
export const CARE_AUDIO_IN_SAMPLE_RATE = 16_000;
export const CARE_AUDIO_IN_MIME = 'audio/pcm;rate=16000';
/// NEVER resample the 24 kHz output to 16 kHz — chipmunk artifacts. Play it
/// through an AudioContext({ sampleRate: 24000 }).
export const CARE_AUDIO_OUT_SAMPLE_RATE = 24_000;

/// Session caps (server-side truth is the ephemeral-token TTL).
export const CARE_SESSION_CAP_MIN: Record<'INTAKE' | 'TREATMENT' | 'REVIEW', number> = {
  INTAKE: 30,
  TREATMENT: 25,
  REVIEW: 25,
};
/// Redeem-token TTL — ≥ the longest session cap (§4.2 step 2).
export const CARE_START_TOKEN_TTL_SEC = 2100;

/// AI Studio v1beta Live endpoint (the `url`-mode base; `key` or
/// `access_token` is appended by the token mint).
export const CARE_LIVE_WSS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Vertex AI Live (`CARE_LIVE_BACKEND=vertex`) — same Gemini models, in-region
 * on the platform service account (DPDP posture; no separate API key). The
 * region + model are env-overridable because native-audio dialog availability
 * on Vertex differs by region and by preview name — run
 * `scripts/care-vertex-live-probe.mjs` to discover the working pair, then set
 * `CARE_LIVE_VERTEX_LOCATION` / `CARE_LIVE_VERTEX_MODEL`.
 */
export const CARE_LIVE_VERTEX_LOCATION_DEFAULT = 'us-central1';
/// Bare model id (no `models/` prefix, no full path) — wrapped into the
/// resource path by careVertexModelPath(). This is the CONFIRMED Vertex name
/// for project cureocity-mind: `gemini-live-2.5-flash-native-audio` reaches
/// setupComplete in us-central1 + us-east4 (NOT asia-south1, NOT global).
/// Note the Vertex name differs from the AI Studio pin (no `-preview`, no
/// date). Re-run scripts/care-vertex-live-probe.mjs if you change project/region.
export const CARE_LIVE_VERTEX_MODEL_DEFAULT = 'gemini-live-2.5-flash-native-audio';

/// Vertex Live WSS base for a region. `global` uses the non-regional host.
export function careVertexWssBase(location: string): string {
  const host =
    location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
}

/// The `setup.model` value Vertex expects — a full publisher resource path.
export function careVertexModelPath(project: string, location: string, model: string): string {
  return `projects/${project}/locations/${location}/publishers/google/models/${model}`;
}

export interface CareLiveSetupInput {
  voiceName: string;
  vadSilenceMs: number;
  systemInstruction: string;
  /// Override the setup's `model` field. AI Studio uses the `models/…` pin
  /// (the default); Vertex passes the full `projects/…/models/…` path.
  model?: string;
}

/**
 * The full setup payload — the FIRST message on the wire (snake_case; both
 * cases work for setup but snake is what the source project ran in prod).
 * The client must wait for `{"setupComplete":{}}` before sending any audio.
 *
 * The two empty `*_transcription` objects are load-bearing: they enable
 * transcript emission. EMPTY OBJECTS ONLY — adding `language_codes` broke
 * transcription entirely in the source project (their May-30 revert).
 */
export function buildCareLiveSetup(input: CareLiveSetupInput): Record<string, unknown> {
  return {
    setup: {
      model: input.model ?? CARE_LIVE_MODEL_ID,
      generation_config: {
        // AUDIO only — TEXT+AUDIO together produces echo. Captions come
        // from output transcription events instead.
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: {
            prebuilt_voice_config: { voice_name: input.voiceName },
          },
        },
      },
      realtime_input_config: {
        automatic_activity_detection: {
          disabled: false,
          start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
          end_of_speech_sensitivity: 'END_SENSITIVITY_LOW',
          silence_duration_ms: clampVadSilence(input.vadSilenceMs),
        },
      },
      input_audio_transcription: {},
      output_audio_transcription: {},
      // §4.7 resilience — Indian mobile networks are hostile. Resumption
      // handles + sliding-window compression keep a 30-min intake alive.
      session_resumption: {},
      context_window_compression: { sliding_window: {} },
      tools: [
        {
          function_declarations: [
            {
              name: 'flag_crisis',
              description:
                'Call IMMEDIATELY if the user expresses self-harm, suicidal thought or plan, harm to others, abuse, or a medical emergency.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  severity: { type: 'STRING', enum: ['MODERATE', 'HIGH', 'CRITICAL'] },
                  reason: { type: 'STRING' },
                },
              },
            },
            {
              name: 'end_session',
              description:
                'Call ONLY after you have given your closing summary and warm goodbye at the very end. You do NOT track time yourself — wait for the [TIME SIGNAL] that tells you to begin closing (or for the user to end). Never call this to finish early; if you feel done sooner, gently ask if there is anything else instead.',
              parameters: {
                type: 'OBJECT',
                properties: { reason: { type: 'STRING' } },
              },
            },
          ],
        },
      ],
      system_instruction: { parts: [{ text: input.systemInstruction }] },
    },
  };
}

export function clampVadSilence(ms: number): number {
  if (!Number.isFinite(ms)) return CARE_VAD_DEFAULT_SILENCE_MS;
  return Math.min(CARE_VAD_MAX_SILENCE_MS, Math.max(CARE_VAD_MIN_SILENCE_MS, Math.round(ms)));
}
