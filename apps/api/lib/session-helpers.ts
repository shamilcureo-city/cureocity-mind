import type { Session as SessionRow } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Cross-tenant aware fetch. Returns the row only when it exists AND
 * belongs to the calling psychologist. Used by every /sessions/:id/*
 * route handler so the ownership check lives in exactly one place.
 */
export async function fetchOwnedSession(
  psychologistId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const row = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!row) return null;
  if (row.psychologistId !== psychologistId) return null;
  return row;
}
