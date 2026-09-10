import { z } from 'zod';
import type { TherapyReasoningV1 } from '@cureocity/contracts';

export const MindCueReviewInputSchema = z
  .object({
    id: z.string().min(1).max(500),
    kind: z.enum(['RED_FLAG', 'ASK_NEXT', 'GAP']),
    state: z.enum(['reviewed', 'dismissed', 'reopened']),
    operationId: z.string().uuid(),
    expectedRevision: z.string().uuid().nullable(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MindCueReviewInput = z.infer<typeof MindCueReviewInputSchema>;
export const MindCueReviewSchema = MindCueReviewInputSchema.omit({ expectedRevision: true }).extend(
  {
    updatedAt: z.string().datetime(),
  },
);
export type MindCueReview = z.infer<typeof MindCueReviewSchema>;
export const cueReviewKey = (kind: MindCueReviewInput['kind'], id: string) => `${kind}:${id}`;
export const MindCueReviewListSchema = z.object({
  records: z.array(MindCueReviewSchema).max(500),
  labels: z.record(z.string().max(2000)).default({}),
});

export function readMindCueReview(metadata: unknown, updatedAt: Date): MindCueReview | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  if (meta.mindCueReviewVersion !== 1) return null;
  const parsed = MindCueReviewSchema.safeParse({
    id: meta.suggestionId,
    kind: meta.kind,
    state: meta.reviewState,
    operationId: meta.operationId,
    updatedAt: updatedAt.toISOString(),
    fingerprint: meta.fingerprint,
  });
  return parsed.success ? parsed.data : null;
}

/** Only a confirmed server state can suppress a current cue. Reopening does
 * not synthesize a suggestion: the UI still uses the latest gateway snapshot. */
export function reviewedCueIds(
  records: readonly MindCueReview[],
  currentFingerprints: Record<string, string> = {},
): Set<string> {
  return new Set(
    records
      .filter(
        (record) =>
          record.state !== 'reopened' &&
          record.fingerprint === currentFingerprints[cueReviewKey(record.kind, record.id)],
      )
      .map((record) => cueReviewKey(record.kind, record.id)),
  );
}

/** Hash only: no extra clinical text or evidence is stored in the review trail.
 * Every displayed field participates, so new evidence/wording reopens the cue. */
export async function cueFingerprints(
  reasoning: TherapyReasoningV1 | null,
): Promise<Record<string, string>> {
  if (!reasoning) return {};
  const cues = [
    ...reasoning.riskWatch.map((cue) => ({ cue, kind: 'RED_FLAG' as const })),
    ...reasoning.askNext.map((cue) => ({ cue, kind: 'ASK_NEXT' as const })),
    ...reasoning.threads.map((cue) => ({ cue, kind: 'GAP' as const })),
  ];
  const entries = await Promise.all(
    cues.map(async ({ cue, kind }) => {
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(cue)),
      );
      return [
        cueReviewKey(kind, cue.id),
        Array.from(new Uint8Array(bytes))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function persistMindCueReview(
  sessionId: string,
  input: MindCueReviewInput,
  request: typeof fetch = fetch,
): Promise<MindCueReview> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await request(`/api/v1/sessions/${sessionId}/mind-cue-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? 'This cue changed in another view. Reload cue history before correcting it.'
          : 'The cue review could not be confirmed saved. Keep the cue in view and retry.',
      );
    const result = MindCueReviewSchema.safeParse(await response.json());
    if (
      !result.success ||
      result.data.id !== input.id ||
      result.data.kind !== input.kind ||
      result.data.operationId !== input.operationId ||
      result.data.state !== input.state ||
      result.data.fingerprint !== input.fingerprint
    )
      throw new Error('The cue review receipt could not be verified. Retry to confirm.');
    return result.data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        'The save reply timed out. The cue stays visible; retry to confirm its status.',
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
