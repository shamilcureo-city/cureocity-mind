export interface PreparationFreshness {
  tone: 'fresh' | 'stale' | 'missing';
  label: string;
}

export function preparationFreshness(
  generatedAt: string | null,
  stale: boolean,
  now = new Date(),
): PreparationFreshness {
  if (!generatedAt) return { tone: 'missing', label: 'Not generated yet' };

  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) {
    return { tone: 'missing', label: 'Generation time unavailable' };
  }
  const ageMs = Math.max(0, now.getTime() - generated.getTime());
  const minutes = Math.floor(ageMs / 60_000);
  const relative =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1_440
          ? `${Math.floor(minutes / 60)}h ago`
          : `${Math.floor(minutes / 1_440)}d ago`;

  return stale
    ? { tone: 'stale', label: `Stale · generated ${relative}` }
    : { tone: 'fresh', label: `Generated ${relative}` };
}
