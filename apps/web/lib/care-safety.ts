import { INDIA_CRISIS_HOTLINES } from '@cureocity/clinical';
import { writeAudit, type AuditWrite } from './audit';
import { prisma } from './prisma';

/**
 * Cureocity Care — the crisis escalation path (§2 layers 4-5). One
 * function for every trigger (deterministic keyword screen, the model's
 * flag_crisis tool, the user's own SOS tap) so the outcome can never
 * depend on which tripwire fired: session hard-stops, the account goes
 * on SAFETY_HOLD, and both are audited atomically.
 */

export type CareCrisisSource = 'keyword_screen' | 'model_tool' | 'user_button';

export async function escalateCareSession(input: {
  careSessionId: string;
  careUserId: string;
  source: CareCrisisSource;
  metadata?: AuditWrite['metadata'];
}): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.careSession.update({
      where: { id: input.careSessionId },
      data: {
        status: 'CRISIS_ESCALATED',
        crisisAt: now,
        crisisSource: input.source,
        endedAt: now,
      },
    });
    await tx.careUser.update({
      where: { id: input.careUserId },
      data: { status: 'SAFETY_HOLD', safetyHoldAt: now },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'CARE_CRISIS_ESCALATED',
        targetType: 'CareSession',
        targetId: input.careSessionId,
        metadata: { source: input.source, ...(input.metadata ?? {}) },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'CARE_SAFETY_HOLD_SET',
        targetType: 'CareUser',
        targetId: input.careUserId,
        metadata: { cause: 'CRISIS_ESCALATION', careSessionId: input.careSessionId },
      },
      tx,
    );
  });
}

/**
 * The crisis-takeover payload — hotlines filtered to the user's
 * languages (falling back to India-wide English lines), plus their
 * trusted contact. Rendered full-screen by the client the moment a
 * `crisis_stop` lands.
 */
export function crisisResources(languages: string[]): Array<{
  name: string;
  number: string;
  hours: string;
  languages: string[];
}> {
  const langSet = new Set(languages.length > 0 ? languages : ['en']);
  const matching = INDIA_CRISIS_HOTLINES.filter((h) => h.languages.some((l) => langSet.has(l)));
  const list = matching.length > 0 ? matching : INDIA_CRISIS_HOTLINES;
  return list.slice(0, 4).map((h) => ({
    name: h.name,
    number: h.number,
    hours: h.hours,
    languages: h.languages,
  }));
}
