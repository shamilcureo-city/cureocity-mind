import type { TodayAttentionItem } from './today-priority';

/** Reduce visual load, never remove a returned failure or unfinished recording. */
export function partitionMindTodayQueue(items: readonly TodayAttentionItem[], previewLimit = 4) {
  const recovery = items.filter((item) => item.kind === 'ACTIVE_SESSION');
  const failures = items.filter(
    (item) => item.kind === 'NOTE_NEEDS_ATTENTION' || item.kind === 'SHARE_FAILURE',
  );
  const activity = items.filter((item) => item.kind === 'RECENT_ACTIVITY');
  const ordinary = items.filter(
    (item) => !recovery.includes(item) && !failures.includes(item) && !activity.includes(item),
  );
  return {
    recovery,
    failures,
    activity,
    preview: ordinary.slice(0, previewLimit),
    remaining: ordinary.slice(previewLimit),
    actionCount: failures.length + ordinary.length,
  };
}
