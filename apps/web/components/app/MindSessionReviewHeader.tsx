import styles from './MindSessionReview.module.css';

export interface MindSessionReviewHeaderProps {
  clientName: string;
  sessionDate: string;
  sessionKind: string;
  status: string;
  isDemo?: boolean;
  spokenLanguageLabel?: string;
}

/** Presentational Mind header: capture ending is not a claim that the note is signed. */
export function MindSessionReviewHeader({
  clientName,
  sessionDate,
  sessionKind,
  status,
  isDemo,
  spokenLanguageLabel,
}: MindSessionReviewHeaderProps) {
  const ended = status === 'COMPLETED';
  return (
    <header className={styles.header}>
      <div>
        <h1>{clientName}</h1>
        <div className={styles.metadata}>
          <span>{sessionDate}</span>
          <span>{sessionKind.toLowerCase().replace(/_/g, ' ')} session</span>
          {spokenLanguageLabel && <span>Spoken in {spokenLanguageLabel}</span>}
          {isDemo && <span>Example client</span>}
        </div>
      </div>
      <div className={styles.sessionMark}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h4M9 12h5M9 16h5" />
        </svg>
        <div>
          <strong>{ended ? 'Session ended' : status.toLowerCase().replace(/_/g, ' ')}</strong>
          <span>
            {ended
              ? 'Your note and next steps, together.'
              : 'The note will be ready after capture ends.'}
          </span>
        </div>
      </div>
    </header>
  );
}
