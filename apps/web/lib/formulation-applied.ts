import type { CaseFormulationV1, FormulationSuggestion } from '@cureocity/contracts';

/**
 * SL3 — true when a formulation suggestion's text is already present in the
 * active body (accepted earlier, or independently authored). Both surfaces
 * that offer suggestions (the Close moment and the Plan-sub formulation
 * card) filter with this so a suggestion stops being offered once its
 * content is on the record — accept state is server truth, not local state.
 */
export function isSuggestionApplied(
  body: CaseFormulationV1 | null,
  s: FormulationSuggestion,
): boolean {
  if (!body) return false;
  const text = s.text.trim().toLowerCase();
  if (text === '') return false;
  const inList = (list: string[]): boolean => list.some((e) => e.trim().toLowerCase() === text);
  switch (s.target) {
    case 'NARRATIVE':
      return body.narrative.toLowerCase().includes(text);
    case 'CYCLE':
      return body.cycle.some((n) => n.text.trim().toLowerCase() === text);
    case 'PREDISPOSING':
      return inList(body.fivePs.predisposing);
    case 'PRECIPITATING':
      return inList(body.fivePs.precipitating);
    case 'PERPETUATING':
      return inList(body.fivePs.perpetuating);
    case 'PROTECTIVE':
      return inList(body.fivePs.protective);
    case 'PREDICTION':
      return body.predictions.some((p) => p.text.trim().toLowerCase() === text);
  }
}
