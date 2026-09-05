interface ProgressSession {
  status: string;
  client: { isDemo: boolean };
  noteDraft: { status: string } | null;
  therapyNote: { locked: boolean; signedAt: Date | string } | null;
}

export function isFinalizedMindNote(note: ProgressSession['therapyNote']): boolean {
  return note?.locked === true && Boolean(note.signedAt);
}

/** Documentation progress, never a clinical score. Example cases do not count. */
export function buildMindTodayProgress(sessions: readonly ProgressSession[]) {
  const completed = sessions.filter(
    (session) => session.status === 'COMPLETED' && !session.client.isDemo,
  );
  const signed = completed.filter((session) => isFinalizedMindNote(session.therapyNote)).length;
  const ready = completed.filter(
    (session) =>
      !isFinalizedMindNote(session.therapyNote) && session.noteDraft?.status === 'COMPLETED',
  ).length;
  return { completed: completed.length, signed, ready, remaining: completed.length - signed };
}
