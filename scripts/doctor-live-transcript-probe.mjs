#!/usr/bin/env node
/**
 * Sprint DS13 — doctor streaming-transcript probe.
 *
 * Answers the three questions gating LIVE_STREAM_TRANSCRIPT=true:
 *   1. Which (region, model) pair reaches setupComplete for a
 *      TRANSCRIPTION-ONLY Live session (TEXT modality, silent system
 *      instruction) — including whether asia-south1 works (DPDP)?
 *   2. Do `input_transcription` fragments actually stream for continuous
 *      audio, and with what first-fragment latency?
 *   3. What does usageMetadata report (the context re-billing check —
 *      promptTokenCount should stay bounded thanks to sliding-window
 *      compression, not grow with the square of the session length)?
 *
 * Usage (same service account the platform already uses — no new credential):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON='{...sa json...}' \
 *   VERTEX_PROJECT_ID=your-project \
 *   node scripts/doctor-live-transcript-probe.mjs path/to/speech-16k-mono.pcm
 *
 * The audio argument is raw 16 kHz mono s16le PCM (a .wav works too — the
 * 44-byte canonical header is skipped automatically). Record one with:
 *   ffmpeg -i sample.mp3 -ar 16000 -ac 1 -f s16le speech-16k-mono.pcm
 *
 * Pin one combo:
 *   LIVE_STREAM_LOCATION=us-central1 LIVE_STREAM_MODEL=gemini-live-2.5-flash \
 *   node scripts/doctor-live-transcript-probe.mjs speech-16k-mono.pcm
 *
 * Requires Node ≥ 20 (global WebSocket + fetch).
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const REGIONS = process.env.LIVE_STREAM_LOCATION
  ? [process.env.LIVE_STREAM_LOCATION]
  : ['asia-south1', 'us-central1', 'us-east4'];

const MODELS = process.env.LIVE_STREAM_MODEL
  ? [process.env.LIVE_STREAM_MODEL]
  : [
      // Text-capable Live candidates first; the probe-confirmed Care
      // native-audio model as the fallback (it also emits input_transcription).
      'gemini-live-2.5-flash',
      'gemini-2.0-flash-live-preview-04-09',
      'gemini-live-2.5-flash-native-audio',
    ];

const STREAM_SECONDS_CAP = 60;
const SETUP_TIMEOUT_MS = 12_000;
const CHUNK_MS = 128;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function serviceAccount() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw)
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account key JSON.');
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key)
    throw new Error('SA JSON missing client_email / private_key.');
  return sa;
}

async function mintToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = base64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token mint failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

function wssBase(location) {
  const host =
    location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
}

// Mirrors buildStreamSetup() in services/live-gateway/src/stream-transcript.ts.
function setupMsg(project, location, model) {
  return {
    setup: {
      model: `projects/${project}/locations/${location}/publishers/google/models/${model}`,
      generation_config: { response_modalities: ['TEXT'], temperature: 0, max_output_tokens: 1 },
      system_instruction: {
        parts: [
          {
            text: 'You are a silent transcription tap. Never answer, comment, or translate. Produce no output.',
          },
        ],
      },
      realtime_input_config: {
        automatic_activity_detection: {
          disabled: false,
          start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
          end_of_speech_sensitivity: 'END_SENSITIVITY_LOW',
          silence_duration_ms: 400,
        },
      },
      input_audio_transcription: {},
      session_resumption: {},
      context_window_compression: { sliding_window: {} },
    },
  };
}

function loadPcm(path) {
  let bytes = readFileSync(path);
  // Canonical 44-byte RIFF/WAVE header → skip it (assume the caller made it
  // 16 kHz mono s16le as instructed).
  if (bytes.length > 44 && bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    bytes = bytes.subarray(44);
  }
  const capBytes = STREAM_SECONDS_CAP * 16_000 * 2;
  return bytes.subarray(0, capBytes);
}

async function textOf(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (data && typeof data.text === 'function') return await data.text();
  try {
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

function probeCombo(token, project, location, model, pcm) {
  return new Promise((resolve) => {
    const url = `${wssBase(location)}?access_token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    const startedAt = Date.now();
    let setupAt = 0;
    let firstFragmentAt = 0;
    let fragments = 0;
    let transcript = '';
    let maxPromptTokens = 0;
    let streamTimer = null;
    let offset = 0;
    const chunkBytes = (16_000 * 2 * CHUNK_MS) / 1000;

    const finish = (result) => {
      if (streamTimer) clearInterval(streamTimer);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };
    const setupTimer = setTimeout(
      () => finish({ ok: false, reason: `no setupComplete in ${SETUP_TIMEOUT_MS}ms` }),
      SETUP_TIMEOUT_MS,
    );

    ws.addEventListener('error', (e) => {
      clearTimeout(setupTimer);
      finish({ ok: false, reason: `socket error: ${e.message ?? 'unknown'}` });
    });
    ws.addEventListener('close', (e) => {
      clearTimeout(setupTimer);
      if (!setupAt) finish({ ok: false, reason: `closed pre-setup code=${e.code} ${e.reason}` });
      else
        finish({
          ok: fragments > 0,
          reason: fragments > 0 ? 'ok' : 'setupComplete but NO input_transcription fragments',
          setupMs: setupAt - startedAt,
          firstFragmentMs: firstFragmentAt ? firstFragmentAt - setupAt : null,
          fragments,
          maxPromptTokens,
          transcript: transcript.slice(0, 200),
        });
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(setupMsg(project, location, model)));
    });
    ws.addEventListener('message', async (event) => {
      let msg;
      try {
        msg = JSON.parse(await textOf(event.data));
      } catch {
        return;
      }
      if (msg.setupComplete || msg.setup_complete) {
        clearTimeout(setupTimer);
        setupAt = Date.now();
        console.log(`    setupComplete in ${setupAt - startedAt}ms — streaming audio…`);
        // Real-time-ish pacing so VAD + billing behave like a consult.
        streamTimer = setInterval(() => {
          if (offset >= pcm.length) {
            clearInterval(streamTimer);
            // Give trailing fragments a moment, then close.
            setTimeout(() => ws.close(), 4_000);
            return;
          }
          const chunk = pcm.subarray(offset, offset + chunkBytes);
          offset += chunkBytes;
          ws.send(
            JSON.stringify({
              realtime_input: {
                media_chunks: [
                  { mime_type: 'audio/pcm;rate=16000', data: chunk.toString('base64') },
                ],
              },
            }),
          );
        }, CHUNK_MS);
        return;
      }
      const um = msg.usageMetadata ?? msg.usage_metadata;
      if (um) {
        const inTok = um.promptTokenCount ?? um.prompt_token_count ?? 0;
        if (typeof inTok === 'number') maxPromptTokens = Math.max(maxPromptTokens, inTok);
      }
      const sc = msg.serverContent ?? msg.server_content;
      const inT = sc?.input_transcription ?? sc?.inputTranscription;
      if (inT?.text) {
        fragments += 1;
        transcript += inT.text;
        if (!firstFragmentAt) {
          firstFragmentAt = Date.now();
          console.log(`    first input_transcription after ${firstFragmentAt - setupAt}ms`);
        }
      }
    });
  });
}

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Usage: node scripts/doctor-live-transcript-probe.mjs <speech-16k-mono.pcm|.wav>');
  process.exit(1);
}
const pcm = loadPcm(audioPath);
console.log(`Audio: ${audioPath} (${(pcm.length / 32000).toFixed(1)}s of 16k mono PCM)`);
const sa = serviceAccount();
const project = process.env.VERTEX_PROJECT_ID ?? sa.project_id;
if (!project) throw new Error('Set VERTEX_PROJECT_ID (or use an SA key with project_id).');
const token = await mintToken(sa);

const passes = [];
for (const location of REGIONS) {
  for (const model of MODELS) {
    console.log(`\n▶ ${location} · ${model}`);
    const r = await probeCombo(token, project, location, model, pcm);
    if (r.ok) {
      console.log(
        `  ✅ PASS — setup ${r.setupMs}ms, first fragment ${r.firstFragmentMs}ms, ` +
          `${r.fragments} fragments, maxPromptTokens ${r.maxPromptTokens}`,
      );
      console.log(`  heard: "${r.transcript}"`);
      passes.push({ location, model, ...r });
    } else {
      console.log(`  ❌ ${r.reason}`);
    }
  }
}

if (passes.length === 0) {
  console.log('\nNo (region, model) pair worked — do NOT set LIVE_STREAM_TRANSCRIPT.');
  process.exit(2);
}
const best = passes[0];
console.log(`\nTo enable the streaming display rail on the gateway:`);
console.log(`  LIVE_STREAM_TRANSCRIPT=true`);
console.log(`  LIVE_STREAM_LOCATION=${best.location}`);
console.log(`  LIVE_STREAM_MODEL=${best.model}`);
if (best.location !== 'asia-south1') {
  console.log(
    `\n⚠ ${best.location} is OUTSIDE India — enabling streams consult audio cross-border.` +
      `\n  Clear this against docs/dpdp-data-flow.md + the consent posture before enabling.`,
  );
}
