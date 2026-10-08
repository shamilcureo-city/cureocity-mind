import { NextResponse } from 'next/server';
import type { Prisma, Session, SessionStatus } from '@prisma/client';

export class ConditionalSessionTransitionError extends Error {
  readonly code = 'SESSION_CONCURRENT_MODIFICATION' as const;

  constructor() {
    super('The session changed while this request was processed');
    this.name = 'ConditionalSessionTransitionError';
  }
}

export class SessionInvalidStateError extends Error {
  readonly code = 'SESSION_INVALID_STATE' as const;

  constructor(status: SessionStatus) {
    super(`Cannot authorize live capture for a session in ${status} state`);
    this.name = 'SessionInvalidStateError';
  }
}

export function assertLiveTokenSessionStatus(status: SessionStatus): void {
  if (status !== 'SCHEDULED' && status !== 'IN_PROGRESS') {
    throw new SessionInvalidStateError(status);
  }
}

export function shouldAdvanceSessionDuringLiveToken(
  _vertical: 'THERAPIST' | 'DOCTOR',
  _status: SessionStatus,
): boolean {
  return false;
}

/**
 * Both products wait for active capture, not a permission/token request.
 * Scribe activation is acknowledged by the trusted gateway's first PCM frame.
 */
export function captureActivationTransitionData(
  _vertical: 'THERAPIST' | 'DOCTOR',
  captureMode: 'LIVE' | 'BATCH',
  captureActive: boolean,
): { status: 'IN_PROGRESS'; startedAt: Date; captureMode: 'LIVE' | null } | null {
  if (!captureActive) return null;
  return {
    status: 'IN_PROGRESS',
    startedAt: new Date(),
    captureMode: captureMode === 'LIVE' ? 'LIVE' : null,
  };
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
  if (
    !(error instanceof ConditionalSessionTransitionError) &&
    !(error instanceof SessionInvalidStateError)
  ) {
    return null;
  }
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
    },
    { status: 409 },
  );
}
