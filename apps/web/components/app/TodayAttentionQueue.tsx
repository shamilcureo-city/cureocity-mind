import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { TodayAttentionItem } from '@/lib/today-priority';
import styles from './MindTodayStudio.module.css';

const labels: Record<TodayAttentionItem['kind'], string> = {
  ACTIVE_SESSION: 'Active session',
  FUTURE_SESSION: 'Next session',
  NOTE_NEEDS_ATTENTION: 'Needs attention',
  NOTE_REVIEW: 'Ready to review',
  NOTE_GENERATING: 'Generating',
  CLIENT_RESPONSE: 'Client response',
  OVERDUE_WORK: 'Overdue',
};

export function TodayAttentionQueue({ items }: { items: readonly TodayAttentionItem[] }) {
  return (
    <section className={styles.attention} aria-label="Needs your attention">
      <div className={styles.sectionHeading}>
        <h2>Needs your attention</h2>
        <span>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <Card className={styles.attentionCard}>
        {items.length === 0 ? (
          <div className={styles.attentionItem}>
            <p className={styles.attentionName}>Nothing waiting in this queue.</p>
            <p className={styles.attentionDetail}>
              Notes to review, client replies and follow-ups appear here.
            </p>
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <li
                key={`${item.kind}:${item.id}`}
                className={styles.attentionItem}
                data-urgent={
                  item.kind === 'NOTE_NEEDS_ATTENTION' || item.kind === 'ACTIVE_SESSION'
                    ? 'true'
                    : undefined
                }
              >
                <div>
                  <p className={styles.attentionLabel}>{labels[item.kind]}</p>
                  <p className={styles.attentionName}>{item.title}</p>
                  {item.detail ? <p className={styles.attentionDetail}>{item.detail}</p> : null}
                </div>
                <Link href={item.href} className={styles.attentionAction}>
                  {item.ctaLabel}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
