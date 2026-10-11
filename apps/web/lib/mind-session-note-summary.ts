/** Canonical saved note fields only; never replace a signed note with an older draft. */
export function summarizeMindSessionNote(
  session: {
    kind?: string;
    noteDraft: { content: unknown } | null;
    therapyNote: { content: unknown } | null;
  } | null,
  maxFieldLength = 400,
): string | null {
  const content = session?.therapyNote?.content ?? session?.noteDraft?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const note = content as Record<string, unknown>;
  // The field check retains compatibility with callers/legacy rows without kind.
  const intake = session?.kind === 'INTAKE' || 'presentingConcerns' in note;
  const fields = intake
    ? [
        ['presentingConcerns', 'Presenting concerns'],
        ['historyOfPresentingIllness', 'History'],
        ['workingHypothesis', 'Working hypothesis'],
        ['immediatePlan', 'Immediate plan'],
      ]
    : [
        ['subjective', 'S'],
        ['assessment', 'A'],
        ['plan', 'P'],
      ];
  return (
    fields
      .flatMap(([key, label]) => {
        const value = note[key!];
        if (typeof value !== 'string' || !value.trim()) return [];
        const text = value.trim();
        return [
          `${label}: ${text.length > maxFieldLength ? `${text.slice(0, maxFieldLength)}…` : text}`,
        ];
      })
      .join(' | ') || null
  );
}
