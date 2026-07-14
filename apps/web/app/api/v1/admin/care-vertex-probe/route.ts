import { NextResponse, type NextRequest } from 'next/server';
import { careVertexModelPath, careVertexWssBase } from '@cureocity/llm';
import { requirePsychologistId } from '@/lib/auth-server';
import { gcpProjectId, mintGcpAccessToken } from '@/lib/gcp-access-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/admin/care-vertex-probe — TEMPORARY diagnostic.
 *
 * Runs the Vertex Live availability probe SERVER-SIDE, where the platform
 * service account (`GOOGLE_APPLICATION_CREDENTIALS_JSON`) already lives — so
 * an operator can discover the working `(region, model)` for
 * `CARE_LIVE_BACKEND=vertex` by opening a URL, no local creds handling.
 *
 * Gated behind a practitioner session (open it while logged into /app).
 * Read-only: opens short Vertex Live sockets with browser-style
 * `?access_token=` auth and reports which reach `setupComplete`.
 *
 * Optional query overrides: `?location=asia-south1&model=<id>` to test one.
 *
 * DELETE THIS ROUTE once the working pair is known.
 */

const DEFAULT_REGIONS = ['us-central1', 'us-east4', 'asia-south1', 'global'];
const DEFAULT_MODELS = [
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-live-2.5-flash-preview-native-audio',
  'gemini-2.0-flash-live-preview-04-09',
];
const PER_COMBO_TIMEOUT_MS = 10_000;

interface ComboResult {
  location: string;
  model: string;
  ok: boolean;
  reason?: string;
}

async function asText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (data && typeof (data as Blob).text === 'function') return await (data as Blob).text();
  try {
    return Buffer.from(data as ArrayBuffer).toString('utf8');
  } catch {
    return '';
  }
}

function probeSetup(project: string, location: string, model: string): Record<string, unknown> {
  return {
    setup: {
      model: careVertexModelPath(project, location, model),
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

function probeCombo(
  token: string,
  project: string,
  location: string,
  model: string,
): Promise<ComboResult> {
  return new Promise((resolve) => {
    const url = `${careVertexWssBase(location)}?access_token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ location, model, ok: false, reason: `ctor: ${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve({ location, model, ok: false, reason: `timeout ${PER_COMBO_TIMEOUT_MS}ms` });
    }, PER_COMBO_TIMEOUT_MS);
    const done = (r: ComboResult): void => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve(r);
    };
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify(probeSetup(project, location, model))),
    );
    ws.addEventListener('message', (ev: MessageEvent) => {
      void asText(ev.data).then((txt) => {
        if (/setupcomplete/i.test(txt)) done({ location, model, ok: true });
        else if (/error|invalid|permission|not\s*found|unsupported/i.test(txt))
          done({ location, model, ok: false, reason: txt.slice(0, 500) });
      });
    });
    ws.addEventListener('error', () => {
      /* the close event carries the code/reason */
    });
    ws.addEventListener('close', (ev: CloseEvent) =>
      done({
        location,
        model,
        ok: false,
        reason: `close ${ev.code} ${(ev.reason || '').slice(0, 500)}`,
      }),
    );
  });
}

/**
 * List the Google publisher models this project can see in a region, filtered
 * to the Live / audio ones — so we learn the exact model NAME to use (or prove
 * native-audio Live isn't offered / enabled for the project there).
 */
async function fetchLiveModels(
  token: string,
  location: string,
): Promise<{ location: string; total?: number; models?: string[]; error?: string }> {
  const host =
    location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  try {
    const res = await fetch(`https://${host}/v1beta1/publishers/google/models?pageSize=300`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { location, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
    const body = (await res.json()) as { publisherModels?: Array<{ name?: string }> };
    const all = (body.publisherModels ?? []).map((m) =>
      (m.name ?? '').replace(/^publishers\/google\/models\//, ''),
    );
    const models = all.filter((n) => /live|audio|native/i.test(n)).sort();
    return { location, total: all.length, models };
  } catch (e) {
    return { location, error: (e as Error).message };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const regions = params.get('location') ? [params.get('location') as string] : DEFAULT_REGIONS;
  const models = params.get('model') ? [params.get('model') as string] : DEFAULT_MODELS;

  let project: string;
  let token: string;
  try {
    project = gcpProjectId();
    token = (await mintGcpAccessToken()).token;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not mint a Vertex token: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const combos: Array<{ location: string; model: string }> = [];
  for (const location of regions) for (const model of models) combos.push({ location, model });

  const results = await Promise.all(
    combos.map((c) => probeCombo(token, project, c.location, c.model)),
  );
  // What Live/audio models can this project actually see, per region?
  const catalog = await Promise.all(regions.map((r) => fetchLiveModels(token, r)));
  const working = results
    .filter((r) => r.ok)
    .map((r) => ({ location: r.location, model: r.model }));
  const best =
    working.find((w) => w.location === 'asia-south1') ||
    working.find((w) => w.location.startsWith('us')) ||
    working[0] ||
    null;

  return NextResponse.json({
    project,
    working,
    availableLiveModels: catalog,
    recommended: best
      ? {
          CARE_LIVE_BACKEND: 'vertex',
          CARE_LIVE_VERTEX_LOCATION: best.location,
          CARE_LIVE_VERTEX_MODEL: best.model,
        }
      : null,
    results,
    note: 'TEMPORARY diagnostic route — delete after use. If every result is a close/1008 auth error, Vertex rejects browser-style ?access_token= (needs a gateway); if "not found", native-audio Live is not in these regions yet.',
  });
}
