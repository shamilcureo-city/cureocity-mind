import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { TodayAttentionItem } from '@/lib/today-priority';
import { partitionMindTodayQueue } from '@/lib/mind-today-queue';
import { formatIstDateTime } from '@/lib/ist';
import styles from './MindTodayStudio.module.css';

const labels: Record<TodayAttentionItem['kind'], string> = {
  ACTIVE_SESSION: 'Unfinished session',
  FUTURE_SESSION: 'Next appointment',
  NOTE_NEEDS_ATTENTION: 'Note needs attention',
  NOTE_REVIEW: 'Unsigned draft',
  NOTE_GENERATING: 'Draft processing',
  CLIENT_RESPONSE: 'Client response',
  SHARE_FAILURE: 'Delivery needs attention',
  RECENT_ACTIVITY: 'Shared item opened',
  OVERDUE_WORK: 'Follow-up',
};

function QueueRows({ items }: { items: readonly TodayAttentionItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li
          key={`${item.kind}:${item.id}`}
          className={styles.attentionItem}
          data-urgent={
            item.kind === 'NOTE_NEEDS_ATTENTION' || item.kind === 'SHARE_FAILURE'
              ? 'true'
              : undefined
          }
        >
          <div>
            <p className={styles.attentionLabel}>{labels[item.kind]}</p>
            <p className={styles.attentionName}>{item.title}</p>
            <p className={styles.attentionDetail}>
              <time dateTime={item.occurredAt}>
                {item.dateLabel ? `${item.dateLabel} ` : ''}
                {formatIstDateTime(item.occurredAt)} IST
              </time>
            </p>
            {item.detail && <p className={styles.attentionDetail}>{item.detail}</p>}
          </div>
          <Link href={item.href} className={styles.attentionAction}>
            {item.ctaLabel}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TodayRecoveryQueue({ items }: { items: readonly TodayAttentionItem[] }) {
  const { recovery } = partitionMindTodayQueue(items);
  if (!recovery.length) return null;
  return (
    <section className={styles.recovery} aria-label="Unfinished sessions">
      <div className={styles.sectionHeading}>
        <h2>Unfinished sessions</h2>
        <span>{recovery.length} shown</span>
      </div>
      <p className={styles.intro}>
        Review or resume saved work. These dates do not mean a microphone is recording now.
      </p>
      <Card className={styles.attentionCard}>
        <QueueRows items={recovery} />
      </Card>
    </section>
  );
}

export function TodayAttentionQueue({ items }: { items: readonly TodayAttentionItem[] }) {
  const { failures, preview, remaining, actionCount, activity } = partitionMindTodayQueue(items);
  return (
    <section className={styles.attention} aria-label="Needs your attention">
      <div className={styles.sectionHeading}>
        <h2>Needs action</h2>
        <span>
          {actionCount} {actionCount === 1 ? 'item' : 'items'} shown
        </span>
      </div>
      <Card className={`${styles.attentionCard} ${styles.actionQueue}`}>
        <div className={styles.queueIntroduction}>
          <span className={styles.queueIllustration} aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <rect
                x="11"
                y="9"
                width="33"
                height="44"
                rx="5"
                transform="rotate(-9 11 9)"
                fill="currentColor"
                opacity=".15"
              />
              <path
                d="M24 7h22a5 5 0 0 1 5 5v39a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5V14a7 7 0 0 1 7-7Z"
                fill="white"
                stroke="currentColor"
                strokeOpacity=".25"
              />
              <path
                d="M26 19h16M26 26h16M26 33h12M26 40h8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity=".6"
              />
              <circle cx="49" cy="49" r="10" fill="currentColor" />
              <path
                d="m45 49 3 3 6-7"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h3>
            {actionCount === 0 ? 'A little space between sessions.' : 'A little time to finish.'}
          </h3>
          <p>
            {actionCount === 0
              ? 'No actions in this view. Your full notes and client history are always available below.'
              : 'Review the work that needs you. Nothing is signed or shared automatically.'}
          </p>
        </div>
        {failures.length > 0 && (
          <div aria-label="Failures to resolve">
            <QueueRows items={failures} />
          </div>
        )}
        <QueueRows items={preview} />
        {remaining.length > 0 && (
          <details className={styles.queueDisclosure}>
            <summary>View all shown actions ({actionCount})</summary>
            <QueueRows items={remaining} />
          </details>
        )}
        <p className={styles.queueFooter}>
          Responses cover the last 7 days; failures and unfinished work are retained.{' '}
          <Link href="/app/notes-due">All unsigned notes</Link> ·{' '}
          <Link href="/app/clients">Client history</Link>
        </p>
      </Card>
      {activity.length > 0 && (
        <details className={styles.activity}>
          <summary>Recent activity · {activity.length} shown</summary>
          <p className={styles.attentionDetail}>
            Recent shared-link openings. An opening does not require a new action.
          </p>
          <QueueRows items={activity} />
        </details>
      )}
    </section>
  );
}
