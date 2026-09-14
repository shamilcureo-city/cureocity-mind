import { tokenize } from './asr/wer';

/** Deterministic regression examples, NOT a semantic or clinical fact checker. */
export interface PhraseAnnotation {
  id: string;
  /** Reviewer-supplied literal alternatives; negation/attribution must be explicit. */
  anyOf: string[];
}

export function containsAnnotatedPhrase(text: string, phrase: string): boolean {
  const tokens = tokenize(text);
  const expected = tokenize(phrase);
  if (expected.length === 0) return false;
  return tokens.some((_, i) => expected.every((word, j) => tokens[i + j] === word));
}

export function scoreAnnotations(
  text: string,
  required: PhraseAnnotation[] = [],
  forbidden: PhraseAnnotation[] = [],
): { missingRequired: string[]; forbiddenPresent: string[]; invalid: boolean } {
  const annotations = [...required, ...forbidden];
  const invalid =
    annotations.some(
      (a) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(a.id) ||
        a.anyOf.length === 0 ||
        a.anyOf.some((p) => tokenize(p).length === 0),
    ) || new Set(annotations.map((a) => a.id)).size !== annotations.length;
  return {
    missingRequired: required
      .filter((a) => !a.anyOf.some((p) => containsAnnotatedPhrase(text, p)))
      .map((a) => a.id),
    forbiddenPresent: forbidden
      .filter((a) => a.anyOf.some((p) => containsAnnotatedPhrase(text, p)))
      .map((a) => a.id),
    invalid,
  };
}
