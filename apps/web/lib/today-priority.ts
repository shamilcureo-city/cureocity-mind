export type TodayAttentionKind =
  | 'ACTIVE_SESSION'
  | 'FUTURE_SESSION'
  | 'NOTE_REVIEW'
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
  NOTE_REVIEW: 2,
  CLIENT_RESPONSE: 3,
  OVERDUE_WORK: 4,
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
