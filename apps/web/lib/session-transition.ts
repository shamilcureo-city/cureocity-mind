import { NextResponse } from 'next/server';
import type { Prisma, Session, SessionStatus } from '@prisma/client';

export class ConditionalSessionTransitionError extends Error {
  readonly code = 'SESSION_CONCURRENT_MODIFICATION' as const;

  constructor() {
    super('The session changed while this request was processed');
    this.name = 'ConditionalSessionTransitionError';
  }
}

export async function conditionalSessionTransition(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    expectedStatus: SessionStatus;
    data: Prisma.SessionUpdateManyMutationInput;
  },
): Promise<Session> {
  const result = await tx.session.updateMany({
    where: { id: input.sessionId, status: input.expectedStatus },
    data: input.data,
  });
  if (result.count !== 1) throw new ConditionalSessionTransitionError();
  return tx.session.findUniqueOrThrow({ where: { id: input.sessionId } });
}

export async function finalizeLiveSession<T>(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    endedAt: Date;
    persistDraft: () => Promise<T>;
    writeLifecycleAudit: () => Promise<void>;
  },
): Promise<T> {
  await conditionalSessionTransition(tx, {
    sessionId: input.sessionId,
    expectedStatus: 'IN_PROGRESS',
    data: { status: 'COMPLETED', endedAt: input.endedAt },
  });
  const draft = await input.persistDraft();
  await input.writeLifecycleAudit();
  return draft;
}

export function sessionConcurrentModificationResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ConditionalSessionTransitionError)) return null;
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
    },
    { status: 409 },
  );
}
