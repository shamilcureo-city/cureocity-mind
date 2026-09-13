import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { VertexAsrEngine } from '../asr/engine';
import { MindAudioManifestSchema, type MindAudioFixture } from './manifest';
import { mindAudioExitCode, runMindAudioEval } from './runner';

/** No default mock or inherited production credentials can silently trigger spending. */
export async function mindAudioCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const unavailable = (reason: string) => {
    console.error(JSON.stringify({ status: 'NOT_EVALUATED', clinicalValidation: false, reason }));
    return 2;
  };
  if (env['MIND_EVAL_ALLOW_PROVIDER_CALLS'] !== 'true')
    return unavailable('PROVIDER_CALLS_NOT_AUTHORIZED');
  if (!env['MIND_EVAL_MANIFEST'] || !env['ASR_AUDIO_DIR'] || !env['VERTEX_PROJECT_ID'])
    return unavailable('MISSING_EVALUATION_CONFIGURATION');
  try {
    const handle = await open(env['MIND_EVAL_MANIFEST'], 'r');
    let raw: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
        return unavailable('INVALID_MANIFEST_FILE');
      raw = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    const parsed = MindAudioManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return unavailable('INVALID_EVALUATION_MANIFEST');
    const engine = new VertexAsrEngine<MindAudioFixture>(env['ASR_AUDIO_DIR'], {
      projectId: env['VERTEX_PROJECT_ID'],
      model: env['VERTEX_FLASH_MODEL'],
      location: env['VERTEX_FLASH_REGION'] ?? 'asia-south1',
      vertical: 'THERAPIST',
      allowProviderCalls: true,
    });
    const report = await runMindAudioEval(engine, parsed.data, 'real-audio');
    console.log(
      JSON.stringify(
        {
          ...report,
          manifestSha256: createHash('sha256').update(raw).digest('hex'),
          corpusVersion: parsed.data.corpusVersion,
          webRevision: parsed.data.webRevision,
          gatewayRevision: parsed.data.gatewayRevision,
          limits: parsed.data.limits,
          runs: engine.runs,
          limitations:
            'Batch Pass-1 WER and literal annotation checks only; not live-browser latency, diarization accuracy, clinical validation or deployment approval.',
        },
        null,
        2,
      ),
    );
    return mindAudioExitCode(report);
  } catch {
    return unavailable('EVALUATION_INPUT_OR_RUNTIME_UNAVAILABLE');
  }
}

if (require.main === module)
  void mindAudioCli().then((code) => {
    process.exitCode = code;
  });
