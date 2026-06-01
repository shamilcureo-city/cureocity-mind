import type { ClientBriefing, TherapyNoteV1 } from '@cureocity/contracts';
import { prisma } from './prisma';
import { toBriefingSessionSummary, toClient, toConsent } from './mappers';

/**
 * Server-side data fetchers for React Server Components.
 *
 * After the apps/api → apps/web fold, the old patient-model-service
 * endpoints live inside this same Next.js process — so RSCs query
 * Prisma directly instead of fetching localhost:3001. This module is
 * the server-side analogue of apps/web/lib/therapist-api.ts.
 *
 * For the demo, the seeded psychologist owns every row. Once real
 * Firebase auth is on, this needs to thread the session cookie / id
 * token to scope queries; an `actorPsychologistId` parameter will be
 * added then.
 */

async function demoPsychologistId(): Promise<string | null> {
  const psy = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    select: { id: true },
  });
  return psy?.id ?? null;
}

export async function fetchClientBriefing(clientId: string): Promise<ClientBriefing | null> {
  const psychologistId = await demoPsychologistId();
  if (!psychologistId) return null;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
    return null;
  }

  const [consents, sessions] = await Promise.all([
    prisma.consent.findMany({
      where: { clientId },
      orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.session.findMany({
      where: { clientId },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    client: toClient(client),
    consents: consents.map(toConsent),
    recentSessions: sessions.map(toBriefingSessionSummary),
    lastNote: null,
  } as ClientBriefing;
}

export interface LastSignedNote {
  id: string;
  sessionId: string;
  signedAt: string;
  content: TherapyNoteV1;
}

/**
 * Sibling of fetchClientBriefing — pulls the most recent signed note
 * for a client so the briefing page can render the carry-over content.
 * Kept separate because ClientBriefing.lastNote is typed as `null` in
 * the contract; widening it is a Sprint-7 contract change.
 */
export async function fetchLastSignedNote(clientId: string): Promise<LastSignedNote | null> {
  const row = await prisma.therapyNote.findFirst({
    where: { session: { clientId } },
    orderBy: { signedAt: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    signedAt: row.signedAt.toISOString(),
    content: row.content as unknown as TherapyNoteV1,
  };
}
