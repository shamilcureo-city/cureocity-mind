import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ScribeIntakeBody, ScribeIntakeReport } from './scribe-intake-contracts';
import type { Prisma } from '@prisma/client';
import { ScribeWorkspaceError } from './scribe-workspace-auth';

export function intakeTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
export function newIntakeGrant(
  expiresInHours: number,
  now = new Date(),
): { token: string; body: ScribeIntakeBody } {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    body: {
      tokenHash: intakeTokenHash(token),
      expiresAt: new Date(now.getTime() + expiresInHours * 3600000).toISOString(),
      revokedAt: null,
      submittedAt: null,
      report: null,
      authorVerified: false,
      review: { status: 'pending', reviewedAt: null, reviewedBy: null, note: '' },
    },
  };
}
export function intakeTokenUsable(
  body: ScribeIntakeBody,
  token: string,
  now = new Date(),
): boolean {
  const expected = Buffer.from(body.tokenHash, 'hex');
  const actual = Buffer.from(intakeTokenHash(token), 'hex');
  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual) &&
    !body.revokedAt &&
    !body.submittedAt &&
    !body.report &&
    body.review.status === 'pending' &&
    Date.parse(body.expiresAt) > now.getTime()
  );
}
export function submittedIntake(
  body: ScribeIntakeBody,
  report: ScribeIntakeReport,
  now = new Date(),
): ScribeIntakeBody {
  return {
    ...body,
    report,
    submittedAt: now.toISOString(),
    authorVerified: false,
    review: { status: 'pending', reviewedAt: null, reviewedBy: null, note: '' },
  };
}
export function publicIntakeRecord<T extends { body: ScribeIntakeBody }>(
  record: T,
): Omit<T, 'body'> & { body: Omit<ScribeIntakeBody, 'tokenHash'> } {
  const { tokenHash: _secret, ...body } = record.body;
  return { ...record, body };
}

/** Re-evaluated after the lifecycle locks, not just before an async write. */
export function intakeFreshnessGuard(expiresAt: string, sessionId?: string) {
  return async (tx: Prisma.TransactionClient): Promise<void> => {
    if (Date.parse(expiresAt) <= Date.now())
      throw new ScribeWorkspaceError(409, 'This intake link has expired.');
    if (sessionId) {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (!session || session.status !== 'SCHEDULED')
        throw new ScribeWorkspaceError(409, 'Previsit intake is closed for this encounter.');
    }
  };
}

/** Stream-bounded parsing for the unauthenticated write-only submission endpoint. */
export async function readIntakeSubmission(req: Request): Promise<unknown> {
  if (!req.body) throw new Error('Invalid submission');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 16000) {
        await reader.cancel();
        throw new Error('Invalid submission');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
