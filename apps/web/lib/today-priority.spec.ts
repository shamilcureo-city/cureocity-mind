import { describe, expect, it } from 'vitest';
import { prioritizeTodayItems, type TodayAttentionItem } from './today-priority';

const item = (
  id: string,
  kind: TodayAttentionItem['kind'],
  occurredAt: string,
): TodayAttentionItem => ({
  id,
  kind,
  occurredAt,
  title: id,
  href: `/${id}`,
  ctaLabel: `Do ${id}`,
});

describe('Today attention priority', () => {
  it('keeps an old overdue session behind the actual next future session', () => {
    const now = new Date('2026-08-30T08:00:00.000Z');
    const result = prioritizeTodayItems(
      [
        item('old-overdue', 'OVERDUE_WORK', '2026-08-20T08:00:00.000Z'),
        item('next-session', 'FUTURE_SESSION', '2026-08-30T09:00:00.000Z'),
      ],
      now,
    );

    expect(result.map(({ id }) => id)).toEqual(['next-session', 'old-overdue']);
  });
});
