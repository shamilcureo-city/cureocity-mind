import { prisma } from './prisma';
import { decryptClientField } from './client-pii';

/**
 * Sprint 24 — build the Pass 7 input context for a single client.
 *
 * Pass 7's job is thematic abstraction across the client's whole arc, so
 * the prompt sees every COMPLETED session's transcript (truncated per
 * session to keep token budget bounded) plus the latest confirmed
 * clinical record + intake history.
 *
 * Returns `text` ready to drop into the user message + `sessionIds` to
 * persist on the resulting map row for the audit trail.
 */
export async function buildConceptualMapContext(
  clientId: string,
  psychologistId: string,
): Promise<{ text: string; sessionIds: string[] }> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId, deletedAt: null },
    select: {
      fullNameEncrypted: true,
      presentingConcerns: true,
      preferredModality: true,
    },
  });
  if (!client) throw new Error('Client not found');
  const clientFullName = await decryptClientField(psychologistId, client.fullNameEncrypted);

  // Pull the completed sessions (with transcript + note) chronologically.
  // Cap at 12 sessions; on a very long-running client, prefer the most
  // recent so the map reflects "where they are now" more than ancient
  // history. We bias-truncate within each transcript later.
  const sessions = await prisma.session.findMany({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    take: 12,
    select: {
      id: true,
      endedAt: true,
      kind: true,
      noteDraft: { select: { transcript: true } },
      therapyNote: { select: { content: true } },
    },
  });

  // Latest confirmed primary diagnosis (if any).
  const diagnosis = await prisma.clientDiagnosis.findFirst({
    where: { clientId, isPrimary: true, supersededAt: null },
    orderBy: { confirmedAt: 'desc' },
    select: { icd11Code: true, icd11Label: true, confidence: true },
  });

  const sessionIds: string[] = [];
  const lines: string[] = [];

  lines.push(`Client: ${clientFullName}`);
  if (client.presentingConcerns) lines.push(`Presenting concerns: ${client.presentingConcerns}`);
  if (client.preferredModality) lines.push(`Preferred modality: ${client.preferredModality}`);
  if (diagnosis) {
    lines.push(
      `Confirmed primary diagnosis: ${diagnosis.icd11Code} ${diagnosis.icd11Label} (confidence ${diagnosis.confidence})`,
    );
  }
  lines.push('');

  // Iterate oldest → newest so the model sees evolution; we sorted desc
  // for the cap, now reverse.
  const orderedSessions = [...sessions].reverse();

  for (const s of orderedSessions) {
    const transcript = s.noteDraft?.transcript ?? null;
    if (!transcript || typeof transcript !== 'string') continue;
    sessionIds.push(s.id);
    lines.push(
      `=== Session ${s.id} (${s.kind}, ended ${s.endedAt?.toISOString() ?? 'unknown'}) ===`,
    );
    lines.push(truncate(transcript, 6000));
    const note = s.therapyNote?.content;
    if (note && typeof note === 'object') {
      const noteSummary = summariseNote(note as Record<string, unknown>);
      if (noteSummary) {
        lines.push('--- Note summary ---');
        lines.push(noteSummary);
      }
    }
    lines.push('');
  }

  return { text: lines.join('\n'), sessionIds };
}

/**
 * Single-character-budget truncation that preserves the head + tail of
 * a long transcript (the start anchors the session, the end captures
 * the takeaway). Keeps roughly half before and half after a `…` break.
 */
function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const half = Math.floor(budget / 2) - 8;
  return `${text.slice(0, half)}\n…\n${text.slice(text.length - half)}`;
}

/** Pull the SOAP fields out of a TherapyNoteV1 body for a one-paragraph summary. */
function summariseNote(body: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const field of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    const v = body[field];
    if (typeof v === 'string' && v.trim()) parts.push(`${field}: ${v.trim()}`);
  }
  return parts.length ? parts.join('\n') : null;
}
