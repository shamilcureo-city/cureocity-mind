import { describe, expect, it, vi } from 'vitest';
import { MindAudioManifestSchema, type MindAudioFixture, type MindAudioManifest } from './manifest';
import { mindAudioExitCode, runMindAudioEval } from './runner';
import { mindAudioCli } from './run';

function fixture(id: string, language: MindAudioFixture['language'] = 'en'): MindAudioFixture {
  return {
    id,
    language,
    spokenLanguages: language === 'mixed' ? ['ml', 'en'] : [language],
    purpose: 'COUNSELLING',
    split: 'held-out',
    reference: 'Sleep improved no current plan',
    criticalPhrases: [{ id: 'negation', anyOf: ['no current plan'] }],
    forbiddenPhrases: [{ id: 'invented', anyOf: ['confirmed diagnosis'] }],
  };
}
function manifest(fixtures: MindAudioFixture[] = [fixture('fictional-en')]): MindAudioManifest {
  return {
    version: 'MIND_AUDIO_EVAL_V1',
    corpusVersion: 'fixture-v1',
    reviewerApprovalId: 'test-review',
    dataHandlingApprovalId: 'test-data',
    webRevision: 'test-web',
    gatewayRevision: 'test-gateway',
    limits: {
      maxWordErrorRate: 0.2,
      minHeldOutCases: 1,
      minCasesPerLanguage: 1,
      requiredLanguages: ['en'],
    },
    fixtures,
  };
}
const exact = { name: 'injected', transcribe: vi.fn(async (f: MindAudioFixture) => f.reference) };

describe('Mind ASR gates (injected fictional fixtures only)', () => {
  it('a mocked passing score is explicitly not a real-audio release pass', async () => {
    const report = await runMindAudioEval(exact, manifest());
    expect(report.status).toBe('PASS');
    expect(report.evidence).toBe('injected');
    expect(report.clinicalValidation).toBe(false);
    expect(mindAudioExitCode(report)).toBe(2);
  });
  it('the CLI decision is nonzero for a deliberately failing real-evidence report', async () => {
    const report = await runMindAudioEval(
      { name: 'test', transcribe: async () => 'lost words' },
      manifest(),
    );
    expect(report.status).toBe('FAIL');
    // Exercise the exit decision only. No real backend/audio is invoked here.
    expect(mindAudioExitCode({ ...report, evidence: 'real-audio' })).toBe(1);
    expect(
      mindAudioExitCode({ ...(await runMindAudioEval(exact, manifest())), evidence: 'real-audio' }),
    ).toBe(0);
  });
  it('does not let clean development cases rescue a failed held-out language', async () => {
    const data = manifest([
      { ...fixture('dev'), split: 'development' },
      fixture('held-en'),
      fixture('held-ml', 'ml'),
    ]);
    data.limits.requiredLanguages = ['en', 'ml'];
    data.limits.maxWordErrorRate = 0.6;
    const report = await runMindAudioEval(
      { name: 'test', transcribe: async (f) => (f.language === 'ml' ? '' : f.reference) },
      data,
    );
    expect(report.heldOutWer).toBe(0.5); // overall within 0.6; Malayalam fails
    expect(report.byLanguage.ml.wer).toBe(1);
    expect(report.status).toBe('FAIL');
  });
  it('reports empty/missing-language/zero-reference coverage as not evaluated', async () => {
    expect((await runMindAudioEval(exact, manifest([]))).status).toBe('NOT_EVALUATED');
    const data = manifest();
    data.limits.requiredLanguages = ['en', 'ml'];
    expect((await runMindAudioEval(exact, data)).status).toBe('NOT_EVALUATED');
    const silent = { ...fixture('silence'), reference: '', criticalPhrases: [] };
    expect((await runMindAudioEval(exact, manifest([silent]))).status).toBe('NOT_EVALUATED');
  });
  it('known critical regressions in development block a clean held-out result', async () => {
    const data = manifest([
      { ...fixture('dev-critical'), split: 'development' },
      fixture('held-clean'),
    ]);
    const report = await runMindAudioEval(
      {
        name: 'test',
        transcribe: async (f) =>
          f.split === 'development' ? 'Sleep improved confirmed diagnosis' : f.reference,
      },
      data,
    );
    expect(report.heldOutWer).toBe(0);
    expect(report.status).toBe('FAIL');
    expect(report.reasons).toContain('ANNOTATED_REGRESSION');
  });
  it('silent audio insertion fails even if normal speech WER is inside its bound', async () => {
    const data = manifest([
      fixture('speech'),
      { ...fixture('silence'), reference: '', criticalPhrases: [] },
    ]);
    const report = await runMindAudioEval(
      { name: 'test', transcribe: async (f) => (f.id === 'silence' ? 'invented' : f.reference) },
      data,
    );
    expect(report.heldOutWer).toBe(0.2);
    expect(report.status).toBe('FAIL');
    expect(report.reasons).toContain('ANNOTATED_REGRESSION');
  });
  it('counts a failed request in the denominator and never exposes its error content', async () => {
    const report = await runMindAudioEval(
      {
        name: 'test',
        transcribe: async (f) => {
          if (f.id === 'broken') throw new Error('secret clinical response');
          return f.reference;
        },
      },
      manifest([fixture('clean'), fixture('broken')]),
    );
    expect(report.total).toBe(2);
    expect(report.failedCases).toBe(1);
    expect(report.status).toBe('FAIL');
    expect(JSON.stringify(report)).not.toContain('secret clinical response');
    const unavailable = await runMindAudioEval(
      {
        name: 'test',
        transcribe: async () => {
          throw new Error();
        },
      },
      manifest(),
    );
    expect(unavailable.status).toBe('NOT_EVALUATED');
  });
  it('rejects malformed/contradictory annotation evidence before backend calls', async () => {
    const transcribe = vi.fn(async () => 'not invoked');
    const data = manifest([
      { ...fixture('bad'), criticalPhrases: [{ id: 'bad-source', anyOf: ['not in reference'] }] },
    ]);
    expect((await runMindAudioEval({ name: 'test', transcribe }, data)).status).toBe(
      'NOT_EVALUATED',
    );
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('manifest validation rejects duplicate IDs, unsafe paths and absent approval references', () => {
    expect(MindAudioManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(
      MindAudioManifestSchema.safeParse(manifest([fixture('same'), fixture('same')])).success,
    ).toBe(false);
    expect(MindAudioManifestSchema.safeParse(manifest([fixture('../outside')])).success).toBe(
      false,
    );
    expect(
      MindAudioManifestSchema.safeParse({ ...manifest(), reviewerApprovalId: '' }).success,
    ).toBe(false);
  });
  it('CLI refuses spending/missing configuration before reading data or calling a provider', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(
        await mindAudioCli({ VERTEX_PROJECT_ID: 'configured', MIND_EVAL_MANIFEST: '/not-read' }),
      ).toBe(2);
      expect(error).toHaveBeenLastCalledWith(
        expect.stringContaining('PROVIDER_CALLS_NOT_AUTHORIZED'),
      );
      expect(await mindAudioCli({ MIND_EVAL_ALLOW_PROVIDER_CALLS: 'true' })).toBe(2);
      expect(error).toHaveBeenLastCalledWith(
        expect.stringContaining('MISSING_EVALUATION_CONFIGURATION'),
      );
    } finally {
      error.mockRestore();
    }
  });
});
