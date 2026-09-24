'use client';

import { useState, type ReactNode } from 'react';
import styles from './ScribeLiveWorkspace.module.css';

export function ScribeLiveWorkspace({
  transcript,
  note,
  prescription,
  copilot,
  alert,
}: {
  transcript: ReactNode;
  note: ReactNode;
  prescription: ReactNode;
  copilot: ReactNode;
  alert?: ReactNode;
}) {
  const [view, setView] = useState<'note' | 'prescription' | 'copilot'>('note');
  const views = [
    ['note', 'Encounter note'],
    ['prescription', 'Prescription'],
    ['copilot', 'Copilot suggestions'],
  ] as const;

  return (
    <div className={styles.workspace}>
      {alert && <div className={styles.alert}>{alert}</div>}
      <div className={styles.columns}>
        <section className={styles.transcript} aria-label="Conversation transcript">
          {transcript}
        </section>
        <section className={styles.document} aria-label="Consultation workspace">
          <div className={styles.tabs} role="tablist" aria-label="Consultation view">
            {views.map(([key, label], index) => (
              <button
                key={key}
                id={`scribe-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={view === key}
                aria-controls={`scribe-panel-${key}`}
                tabIndex={view === key ? 0 : -1}
                onClick={() => setView(key)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % views.length
                      : event.key === 'ArrowLeft'
                        ? (index + views.length - 1) % views.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? views.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  const target = views[next];
                  if (!target) return;
                  setView(target[0]);
                  document.getElementById(`scribe-tab-${target[0]}`)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {views.map(([key]) => (
            <div
              key={key}
              id={`scribe-panel-${key}`}
              role="tabpanel"
              aria-labelledby={`scribe-tab-${key}`}
              hidden={view !== key}
              tabIndex={0}
              className={styles.panel}
            >
              {key === 'note' ? note : key === 'prescription' ? prescription : copilot}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** This meter uses measured RMS microphone input, never a looping animation. */
export function ScribeInputMeter({ level, active }: { level: number; active: boolean }) {
  const normalized = active && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  // A display gain makes ordinary speech legible; it is not a clinical score.
  const displayLevel = Math.min(1, Math.sqrt(normalized));
  return (
    <span className={styles.inputMeter}>
      <span
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized * 100)}
        aria-valuetext={
          !active ? 'Microphone off' : normalized > 0.005 ? 'Sound detected' : 'Quiet input'
        }
        className={styles.meterTrack}
      >
        <span style={{ width: `${displayLevel * 100}%` }} />
      </span>
      <span>{!active ? 'Mic off' : normalized > 0.005 ? 'Sound detected' : 'Quiet input'}</span>
    </span>
  );
}

export { styles as scribeLiveStyles };
