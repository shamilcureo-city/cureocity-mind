import type { ReactNode } from 'react';
import styles from './MindSessionReview.module.css';

/** Keep writing assistance available without competing with the clinical note. */
export function MindSessionNoteTools({
  focused,
  signed,
  children,
}: {
  focused: boolean;
  signed: boolean;
  children: ReactNode;
}) {
  if (!focused) return <>{children}</>;
  if (signed) return null;
  return (
    <details className={styles.disclosure}>
      <summary>Ask AI to help edit this note</summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
