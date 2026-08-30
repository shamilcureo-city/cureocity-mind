export type TodayAttentionKind =
  | 'ACTIVE_SESSION'
  | 'FUTURE_SESSION'
  | 'NOTE_NEEDS_ATTENTION'
  | 'NOTE_REVIEW'
  | 'NOTE_GENERATING'
  | 'CLIENT_RESPONSE'
  | 'OVERDUE_WORK';

export interface TodayAttentionItem {
  id: string;
  kind: TodayAttentionKind;
  occurredAt: string;
  title: string;
  href: string;
  ctaLabel: string;
  detail?: string;
}

const rank: Record<TodayAttentionKind, number> = {
  ACTIVE_SESSION: 0,
  FUTURE_SESSION: 1,
  NOTE_NEEDS_ATTENTION: 2,
  NOTE_REVIEW: 3,
  NOTE_GENERATING: 4,
  CLIENT_RESPONSE: 5,
  OVERDUE_WORK: 6,
};

export function prioritizeTodayItems(
  items: readonly TodayAttentionItem[],
  _now: Date = new Date(),
): TodayAttentionItem[] {
  return [...items].sort((a, b) => {
    const category = rank[a.kind] - rank[b.kind];
    if (category !== 0) return category;
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  });
}
