import Link from 'next/link';
import type { PrepareSummaryV1 } from '@cureocity/contracts';
import { formatIstDate } from '@/lib/ist';
import styles from './MindPreparationStudio.module.css';

/** Read-only scan of existing context. Never invents a current update or adopts a suggestion. */
export function MindPreparationBriefing({ data }: { data: PrepareSummaryV1 }) {
  const { cachedBrief, briefIsStale, homework, carriedQuestions } = data;
  const hasCurrentBrief = !!cachedBrief && !briefIsStale;
  return (
    <div className={styles.briefGrid}>
      <section className={styles.briefCard} aria-label="Previous session context">
        <span className={styles.briefIcon} aria-hidden="true">
          ↶
        </span>
        <h3>{briefIsStale ? 'Saved recap' : 'At the last session'}</h3>
        <p>
          {cachedBrief?.lastSessionRecap ||
            'No previous session recap is available. Begin with the client’s priorities.'}
        </p>
        {cachedBrief && data.briefGeneratedAt && (
          <small>
            AI brief generated {formatIstDate(data.briefGeneratedAt)} · not a new update
          </small>
        )}
        {briefIsStale ? (
          <p className={styles.stale} role="status">
            This brief is out of date. Review the source records or refresh the full preparation
            before using its direction.
          </p>
        ) : data.lastCompletedSessionId ? (
          <Link href={`/app/sessions/${data.lastCompletedSessionId}`}>Open last session</Link>
        ) : null}
      </section>
      <section
        className={`${styles.briefCard} ${styles.carryCard}`}
        aria-label="Between-session practice"
      >
        <span className={styles.briefIcon} aria-hidden="true">
          ▤
        </span>
        <h3>Carry forward</h3>
        {homework.length > 0 ? (
          <ul>
            {homework.slice(0, 2).map((item) => (
              <li key={item.id}>
                <p>{item.description}</p>
                <small>
                  Recorded status: {item.status.toLowerCase().replace(/_/g, ' ')} · assigned{' '}
                  {formatIstDate(item.assignedAt)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent practice task is recorded. Ask whether there is anything to revisit.</p>
        )}
        <small>Check the client’s experience today; a saved status is not a new assessment.</small>
      </section>
      <section className={`${styles.briefCard} ${styles.planCard}`} aria-label="Possible agenda">
        <span className={styles.briefIcon} aria-hidden="true">
          ◇
        </span>
        <h3>Plan for today</h3>
        {hasCurrentBrief ? (
          <p>{cachedBrief.todaysFocus}</p>
        ) : (
          <p>Agree the focus together. No current AI preparation suggestion is available.</p>
        )}
        {carriedQuestions.length > 0 && (
          <small>
            {carriedQuestions.length} carried{' '}
            {carriedQuestions.length === 1 ? 'question is' : 'questions are'} available in full
            preparation.
          </small>
        )}
        <small>
          {hasCurrentBrief
            ? 'AI suggestion · review its fit with the client'
            : 'Your judgment and the client’s priorities come first.'}
        </small>
      </section>
    </div>
  );
}
