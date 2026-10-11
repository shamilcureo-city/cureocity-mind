import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { canonicalJson } from './sign-note-payload';

export class LiveFinalizationConflict extends Error {
  constructor() {
    super('This save operation was already used for different content. Reload the saved session.');
  }
}

export function liveFinalizationDigest(
  sessionId: string,
  psychologistId: string,
  payload: unknown,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        domain: 'MIND_LIVE_FINALIZATION_V1',
        sessionId,
        psychologistId,
        payload,
      }),
    )
    .digest('hex');
}

/** Called under the client write lock. The existing atomic lifecycle audit is
 * a content-free receipt; a replay never replaces an edited or signed note. */
export async function findLiveFinalizationReceipt(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; psychologistId: string; operationId: string; digest: string },
): Promise<{ id: string; status: string } | null> {
  const receipt = await tx.auditLog.findFirst({
    where: {
      actorPsychologistId: input.psychologistId,
      action: 'SESSION_ENDED',
      targetType: 'Session',
      targetId: input.sessionId,
      metadata: { path: ['liveFinalizationId'], equals: input.operationId },
    },
    select: { metadata: true },
  });
  if (!receipt) return null;
  const metadata = receipt.metadata as Record<string, unknown> | null;
  if (metadata?.liveFinalizationDigest !== input.digest) throw new LiveFinalizationConflict();
  const draft = await tx.noteDraft.findUnique({
    where: { sessionId: input.sessionId },
    select: { id: true, status: true },
  });
  if (!draft) throw new LiveFinalizationConflict();
  return draft;
}
