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
}

const TABS: TabSpec[] = [
  { key: 'note', label: 'Review & close' },
  { key: 'review', label: 'Clinical context' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'details', label: 'Session details' },
];

/** Mind keeps longitudinal care on the client and visit evidence on the session. */
export function SessionWorkspaceTabs({ sessionId, active = 'note' }: Props) {
  return (
    <nav className={styles.tabs} aria-label="Session sections">
      {TABS.map((tab) => {
        const activeTab = tab.key === active;
        const href = `/app/sessions/${sessionId}?tab=${tab.key}`;
        return (
          <Link
            key={tab.key}
            href={href}
            className={styles.tab}
            aria-current={activeTab ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
