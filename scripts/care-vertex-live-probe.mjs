#!/usr/bin/env node
/**
 * Cureocity Care — Vertex AI Live availability probe.
 *
 * Answers the open question behind `CARE_LIVE_BACKEND=vertex`: is a
 * native-audio Gemini Live model reachable on Vertex, in which region, and
 * does browser-style `?access_token=` auth work (so the browser can connect
 * directly, no gateway)?
 *
 * Runs with the SAME service account the platform already uses for Vertex —
 * no new credential:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON='{...sa json...}' \
 *   VERTEX_PROJECT_ID=your-project \
 *   node scripts/care-vertex-live-probe.mjs
 *
 * Pin a single combo to test just that one:
 *   CARE_LIVE_VERTEX_LOCATION=asia-south1 \
 *   CARE_LIVE_VERTEX_MODEL=gemini-2.5-flash-native-audio-preview-12-2025 \
 *   node scripts/care-vertex-live-probe.mjs
 *
 * For each (region, model) it opens the Vertex LlmBidiService socket, sends a
 * minimal AUDIO setup, and waits for `setupComplete`. It prints which pairs
 * PASS, then the exact env vars to set. Requires Node ≥ 20 (global WebSocket).
 */
import { createSign } from 'node:crypto';

const REGIONS = process.env.CARE_LIVE_VERTEX_LOCATION
  ? [process.env.CARE_LIVE_VERTEX_LOCATION]
  : ['us-central1', 'us-east4', 'asia-south1', 'global'];

const MODELS = process.env.CARE_LIVE_VERTEX_MODEL
  ? [process.env.CARE_LIVE_VERTEX_MODEL]
  : [
      'gemini-2.5-flash-native-audio-preview-12-2025',
      'gemini-2.5-flash-preview-native-audio-dialog',
      'gemini-live-2.5-flash-preview-native-audio',
      'gemini-2.0-flash-live-preview-04-09',
    ];

const PER_COMBO_TIMEOUT_MS = 12_000;

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

function setupMsg(project, location, model) {
  return {
    setup: {
      model: `projects/${project}/locations/${location}/publishers/google/models/${model}`,
      generation_config: {
        response_modalities: ['AUDIO'],
        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: 'Kore' } } },
      },
      input_audio_transcription: {},
      output_audio_transcription: {},
      system_instruction: { parts: [{ text: 'probe' }] },
    },
  };
}

async function textOf(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (data && typeof data.text === 'function') return await data.text(); // Blob
  try {
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

function tryCombo(token, project, location, model) {
  return new Promise((resolve) => {
    const url = `${wssBase(location)}?access_token=${encodeURIComponent(token)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, reason: `WS ctor: ${e.message}` });
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ ok: false, reason: `timeout after ${PER_COMBO_TIMEOUT_MS}ms (no setupComplete)` });
    }, PER_COMBO_TIMEOUT_MS);
    const done = (r) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(r);
    };
    ws.addEventListener('open', () => ws.send(JSON.stringify(setupMsg(project, location, model))));
    ws.addEventListener('message', async (ev) => {
      const txt = await textOf(ev.data);
      if (/setupcomplete/i.test(txt)) done({ ok: true });
      else if (/error|invalid|permission|not\s*found|unsupported/i.test(txt))
        done({ ok: false, reason: txt.slice(0, 240) });
    });
    ws.addEventListener('error', () => {
      /* the close event carries the useful code/reason */
    });
    ws.addEventListener('close', (ev) =>
      done({
        ok: false,
        reason: `closed code=${ev.code} reason=${(ev.reason || '').slice(0, 200)}`,
      }),
    );
  });
}

async function main() {
  const sa = serviceAccount();
  const project = process.env.VERTEX_PROJECT_ID || sa.project_id;
  if (!project) throw new Error('Set VERTEX_PROJECT_ID (or include project_id in the SA JSON).');
  console.log(`Project: ${project}`);
  console.log('Minting cloud-platform access token…');
  const token = await mintToken(sa);
  console.log('Token OK. Probing (region × model) — browser-style ?access_token= auth:\n');

  const passes = [];
  for (const location of REGIONS) {
    for (const model of MODELS) {
      process.stdout.write(`  ${location.padEnd(12)} ${model.padEnd(52)} … `);
      const r = await tryCombo(token, project, location, model);
      if (r.ok) {
        console.log('PASS ✅');
        passes.push({ location, model });
      } else {
        console.log(`fail — ${r.reason}`);
      }
    }
  }

  console.log('\n────────────────────────────────────────');
  if (passes.length === 0) {
    console.log('No (region, model) reached setupComplete.');
    console.log('If every fail is an auth/close-1008 error, Vertex Live likely rejects');
    console.log('browser-style ?access_token= → browser-direct is not viable (needs a gateway),');
    console.log('or the SA lacks aiplatform access. If fails are "model not found", native-audio');
    console.log('Live is not in these regions yet → use CARE_LIVE_BACKEND=ai-studio for now.');
    process.exitCode = 1;
    return;
  }
  const best =
    passes.find((p) => p.location === 'asia-south1') ||
    passes.find((p) => p.location.startsWith('us')) ||
    passes[0];
  console.log('Working pairs:');
  for (const p of passes) console.log(`  • ${p.location} / ${p.model}`);
  console.log('\nSet these in Vercel (Production) and redeploy:');
  console.log(`  CARE_LIVE_BACKEND=vertex`);
  console.log(`  CARE_LIVE_VERTEX_LOCATION=${best.location}`);
  console.log(`  CARE_LIVE_VERTEX_MODEL=${best.model}`);
}

main().catch((e) => {
  console.error('\nProbe error:', e.message);
  process.exitCode = 1;
});
