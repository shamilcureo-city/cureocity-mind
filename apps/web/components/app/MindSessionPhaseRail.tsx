import styles from './MindSessionReview.module.css';

export type MindSessionPhase = 'prepare' | 'session' | 'review';

export function mindSessionPhaseForStatus(status: string): MindSessionPhase | null {
  if (status === 'SCHEDULED') return 'prepare';
  if (status === 'IN_PROGRESS') return 'session';
  if (status === 'COMPLETED') return 'review';
  return null;
}

const PHASES: Array<{ key: MindSessionPhase; label: string }> = [
  { key: 'prepare', label: 'Prepare' },
  { key: 'session', label: 'Session' },
  { key: 'review', label: 'Review & finish' },
];

/** A visual orientation aid only. Session state continues to come from the server. */
export function MindSessionPhaseRail({ active }: { active: MindSessionPhase }) {
  const activeIndex = PHASES.findIndex((phase) => phase.key === active);

  return (
    <ol className={styles.phaseRail} aria-label="Session workflow">
      {PHASES.map((phase, index) => {
        const complete = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li
            key={phase.key}
            className={`${styles.phaseStep} ${current ? styles.phaseStepCurrent : ''}`}
            aria-current={current ? 'step' : undefined}
          >
            <span className={styles.phaseMarker} aria-hidden="true">
              {complete ? '✓' : index + 1}
            </span>
            <span>
              {complete && <span className="sr-only">Completed: </span>}
              {phase.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
