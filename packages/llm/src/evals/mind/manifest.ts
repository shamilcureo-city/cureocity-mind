import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const phrase = z
  .object({ id: identifier, anyOf: z.array(z.string().trim().min(1)).min(1) })
  .strict();
export const MindAudioFixtureSchema = z
  .object({
    id: identifier,
    language: z.enum(['en', 'ml', 'mixed']),
    spokenLanguages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1),
    purpose: z.enum(['ASSESSMENT', 'COUNSELLING', 'THERAPY', 'REVIEW']),
    split: z.enum(['development', 'held-out']),
    reference: z.string().max(1_000_000),
    /** Required even for silence: an empty array means explicitly none annotated. */
    criticalPhrases: z.array(phrase),
    forbiddenPhrases: z.array(phrase),
  })
  .strict();
export type MindAudioFixture = z.infer<typeof MindAudioFixtureSchema>;

/** Protected local manifest: never commit actor audio, references or annotations. */
export const MindAudioManifestSchema = z
  .object({
    version: z.literal('MIND_AUDIO_EVAL_V1'),
    corpusVersion: identifier,
    reviewerApprovalId: identifier,
    dataHandlingApprovalId: identifier,
    webRevision: identifier,
    gatewayRevision: identifier,
    // No default quality threshold: reviewers must approve a provisional bound
    // before opening held-out results. WER is not clinical factual accuracy.
    limits: z
      .object({
        maxWordErrorRate: z.number().min(0).max(1),
        minHeldOutCases: z.number().int().positive(),
        minCasesPerLanguage: z.number().int().positive(),
        requiredLanguages: z.array(z.enum(['en', 'ml', 'mixed'])).min(1),
      })
      .strict(),
    fixtures: z.array(MindAudioFixtureSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.fixtures.map((f) => f.id)).size !== value.fixtures.length) {
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_FIXTURE_ID' });
    }
    if (new Set(value.limits.requiredLanguages).size !== value.limits.requiredLanguages.length) {
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_LANGUAGE' });
    }
  });
export type MindAudioManifest = z.infer<typeof MindAudioManifestSchema>;
