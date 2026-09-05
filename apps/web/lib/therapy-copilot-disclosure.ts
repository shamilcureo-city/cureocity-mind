import type { TherapyReasoningV1 } from '@cureocity/contracts';
import { liveCopilotVisibleCounts } from './mind-guidance';

export interface DisclosedCopilotSuggestion {
  id: string;
  kind: 'ASK_NEXT' | 'RED_FLAG' | 'GAP';
  label: string;
}

/** Disclosed in the rail, not necessarily read or acted on by the clinician. */
export function disclosedCopilotSuggestions(
  reasoning: TherapyReasoningV1,
  mode: 'quiet' | 'guided',
  expanded: { live: boolean; threads: boolean },
): DisclosedCopilotSuggestion[] {
  const risks: DisclosedCopilotSuggestion[] = reasoning.riskWatch
    .filter((item) => item.source !== 'CARRIED_RISK')
    .map((item) => ({ id: item.id, kind: 'RED_FLAG', label: item.label }));
  if (mode === 'quiet') return risks;

  const live = reasoning.askNext.filter((item) => item.source !== 'CARRIED');
  const visible = liveCopilotVisibleCounts(mode, 0, live.length, reasoning.threads.length);
  return [
    ...risks,
    ...live.slice(0, expanded.live ? live.length : visible.live).map((item) => ({
      id: item.id,
      kind: 'ASK_NEXT' as const,
      label: item.question,
    })),
    ...reasoning.threads
      .slice(0, expanded.threads ? reasoning.threads.length : visible.threads)
      .map((item) => ({ id: item.id, kind: 'GAP' as const, label: item.topic })),
  ];
}

/** Keep receipt/reordering, closing/reopening, and effect replay from duplicating shown events. */
export function markCopilotSuggestionShown(
  tracker: { sessionId: string; ids: Set<string> },
  sessionId: string,
  id: string,
): boolean {
  if (tracker.sessionId !== sessionId) {
    tracker.sessionId = sessionId;
    tracker.ids.clear();
  }
  if (tracker.ids.has(id)) return false;
  tracker.ids.add(id);
  return true;
}
