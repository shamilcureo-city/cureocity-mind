import Link from 'next/link';
import type { buildMindTodayProgress } from './MindTodayProgress';
import styles from './MindTodayStudio.module.css';

export function MindTodayMilestones({
  progress,
}: {
  progress: ReturnType<typeof buildMindTodayProgress>;
}) {
  const allSigned = progress.completed > 0 && progress.remaining === 0;
  return (
    <section className={styles.milestones} aria-labelledby="documentation-heading">
      <div
        className={`${styles.milestoneSeal} ${allSigned ? styles.sealComplete : ''}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M10 5h12v22H6V9l4-4Z" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 5v5H6m5 5h7m-7 4h4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {allSigned && (
            <path
              d="m18 23 3 3 6-7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
      <div className={styles.milestoneCopy}>
        <h2 id="documentation-heading">
          {allSigned ? 'Today’s session records are signed.' : 'A little less to carry home.'}
        </h2>
        <p>
          {progress.completed === 0
            ? 'Your documentation progress appears here after a real session.'
            : `${progress.signed} of ${progress.completed} completed session${progress.completed === 1 ? '' : 's'} on today’s agenda signed${progress.ready > 0 ? ` · ${progress.ready} ready to review` : ''}.`}
        </p>
        {progress.completed > 0 && (
          <progress
            className={styles.progress}
            value={progress.signed}
            max={progress.completed}
            aria-label="Signed records for completed real sessions on today’s agenda"
          />
        )}
      </div>
      <Link href="/app/notes-due" className={styles.textLink}>
        {allSigned ? 'Check all notes' : 'Open notes to finish'}
      </Link>
    </section>
  );
}
