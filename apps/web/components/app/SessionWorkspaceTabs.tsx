import Link from 'next/link';
import type { SessionKind } from '@cureocity/contracts';
import styles from './MindSessionReview.module.css';

export type TabKey = 'review' | 'note' | 'transcript' | 'details';

interface TabSpec {
  key: TabKey;
  label: string;
}

interface Props {
  sessionId: string;
  active?: TabKey;
  sessionKind?: SessionKind;
  canReviewClinical?: boolean;
  hrefBase?: string;
}

const TABS: TabSpec[] = [
  { key: 'note', label: 'Review & finish' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'details', label: 'Session details' },
];

/** Mind keeps longitudinal care on the client and visit evidence on the session. */
export function SessionWorkspaceTabs({
  sessionId,
  active = 'note',
  canReviewClinical = true,
  hrefBase,
}: Props) {
  const sessionHref = hrefBase ?? `/app/sessions/${sessionId}`;
  const sourceTabs = TABS.filter((tab) => tab.key !== 'note');
  const sourceActive = active === 'transcript' || active === 'details';
  const sourceLabel = sourceTabs.find((tab) => tab.key === active)?.label ?? 'Sources & details';

  return (
    <nav className={styles.tabs} aria-label="Session sections">
      <Link
        href={`${sessionHref}?tab=note`}
        className={styles.tab}
        aria-current={active === 'note' ? 'page' : undefined}
      >
        Review &amp; finish
      </Link>
      <details className={styles.sourceMenu}>
        <summary
          className={styles.tab}
          aria-label={sourceActive ? `${sourceLabel}, current section` : 'Open sources and details'}
        >
          <span>{sourceLabel}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className={styles.sourceMenuPanel}>
          {sourceTabs
            .filter((tab) => canReviewClinical || tab.key !== 'review')
            .map((tab) => {
              const description =
                tab.key === 'transcript'
                  ? 'Conversation evidence and session mindmap'
                  : 'Preparation, processing and session information';
              return (
                <Link
                  key={tab.key}
                  href={`${sessionHref}?tab=${tab.key}`}
                  className={styles.sourceMenuLink}
                  aria-label={`${tab.label}. ${description}`}
                  aria-current={tab.key === active ? 'page' : undefined}
                >
                  <span>{tab.label}</span>
                  <small>{description}</small>
                </Link>
              );
            })}
        </div>
      </details>
    </nav>
  );
}
