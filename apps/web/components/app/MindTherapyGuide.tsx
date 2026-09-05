'use client';

import { useId, useMemo, useState } from 'react';
import type { TherapyScriptV1 } from '@cureocity/contracts';
import { Button } from '@/components/ui/Button';
import { mindGuideSteps, reviewedGuideCount } from '@/lib/mind-guidance';
import styles from './MindTherapyGuide.module.css';

export interface PreparedMindGuide {
  id: string;
  body: TherapyScriptV1;
  updatedAt: string;
}

/** Read-only, clinician-led use of an existing AI draft. No generated steps,
 * diagnoses, signed records or delivered interventions are inferred here. */
export function MindTherapyGuide({ script }: { script: TherapyScriptV1 }) {
  const steps = useMemo(() => mindGuideSteps(script), [script]);
  const [mode, setMode] = useState<'guided' | 'overview'>('overview');
  const [reviewedForUse, setReviewedForUse] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const statusId = useId();
  const active = steps[activeIndex] ?? steps[0]!;
  const count = reviewedGuideCount(steps, reviewed);

  function toggleReviewed() {
    setReviewed((current) => {
      const next = new Set(current);
      if (next.has(active.id)) next.delete(active.id);
      else next.add(active.id);
      return next;
    });
  }

  return (
    <section className={styles.guide} aria-label="Psychologist session guide">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your session companion</p>
          <h2 className={styles.title}>{script.therapyName}</h2>
          <p className={styles.meta}>
            AI-drafted guidance · {steps.length} guide sections · Adapt to the client
          </p>
        </div>
        <div className={styles.modes} role="group" aria-label="Guide view">
          <button
            type="button"
            aria-pressed={mode === 'overview'}
            onClick={() => setMode('overview')}
          >
            Overview
          </button>
          <button type="button" aria-pressed={mode === 'guided'} onClick={() => setMode('guided')}>
            Step by step
          </button>
        </div>
      </header>

      <div className={styles.reviewGate} data-reviewed={reviewedForUse}>
        {!reviewedForUse && (
          <>
            <h3>Make this guide your own.</h3>
            <p>
              Review the whole draft and watchpoints before using it. Choose what fits your
              competence, the current case and the client’s preferences. You can change direction at
              any point.
            </p>
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={reviewedForUse}
            onChange={(event) => setReviewedForUse(event.target.checked)}
          />
          <span>
            {reviewedForUse
              ? 'Suitability reviewed for this view. Uncheck to pause guide navigation.'
              : 'I have reviewed this draft for suitability. Enable guide navigation.'}
          </span>
        </label>
      </div>

      {script.riskWatchpoints.length > 0 && (
        <section className={styles.watch} aria-label="Guide watchpoints">
          <strong>Pause and reassess if these concerns arise</strong>
          <ul>
            {script.riskWatchpoints.map((cue, index) => (
              <li key={index}>{cue}</li>
            ))}
          </ul>
        </section>
      )}

      {mode === 'overview' || !reviewedForUse ? (
        <div className={styles.overview}>
          {steps.map((step, index) => (
            <section key={step.id}>
              <span className={styles.label}>Section {index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              {step.listenFor && (
                <p>
                  <strong>
                    {step.kind === 'between_sessions' ? 'If agreed: ' : 'Listen for: '}
                  </strong>
                  {step.listenFor}
                </p>
              )}
              {step.branches.length > 0 && (
                <details className={styles.details}>
                  <summary>Possible responses & adaptations</summary>
                  {step.branches.map((branch, i) => (
                    <div key={i} className={styles.branch}>
                      <strong>If: {branch.ifClientSays}</strong>
                      <p>{branch.thenDo}</p>
                    </div>
                  ))}
                </details>
              )}
            </section>
          ))}
          {reviewedForUse && (
            <Button onClick={() => setMode('guided')}>Open step-by-step guide</Button>
          )}
        </div>
      ) : (
        <div className={styles.journey}>
          <nav className={styles.path} aria-label="Guide sections">
            <ol>
              {steps.map((step, index) => (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-current={index === activeIndex ? 'step' : undefined}
                  >
                    <span
                      className={`${styles.node} ${reviewed.has(step.id) ? styles.nodeDone : ''}`}
                      aria-hidden="true"
                    >
                      {reviewed.has(step.id) ? '✓' : index + 1}
                    </span>
                    <span>
                      {step.title}
                      {reviewed.has(step.id) && <span className="sr-only"> — reviewed</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className={styles.stepBody}>
            <p className={styles.label} role="status">
              Section {activeIndex + 1} of {steps.length}
            </p>
            <h3>{active.title}</h3>
            <p className={styles.prompt}>{active.text}</p>
            {active.listenFor && (
              <div className={styles.listen}>
                <strong>
                  {active.kind === 'between_sessions'
                    ? 'Only if agreed with the client'
                    : 'Listen for'}
                </strong>
                <p>{active.listenFor}</p>
              </div>
            )}
            {active.branches.length > 0 && (
              <details className={styles.details} key={active.id}>
                <summary>
                  Explore {active.branches.length} possible{' '}
                  {active.branches.length === 1 ? 'response' : 'responses'}
                </summary>
                {active.branches.map((branch, index) => (
                  <div className={styles.branch} key={index}>
                    <strong>If: {branch.ifClientSays}</strong>
                    <p>{branch.thenDo}</p>
                  </div>
                ))}
              </details>
            )}
            <div className={styles.controls}>
              <Button
                variant="secondary"
                size="sm"
                onClick={toggleReviewed}
                aria-pressed={reviewed.has(active.id)}
                aria-describedby={statusId}
              >
                {reviewed.has(active.id) ? '✓ Reviewed · undo' : 'Mark section reviewed'}
              </Button>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={activeIndex === steps.length - 1}
                  onClick={() => setActiveIndex((i) => Math.min(steps.length - 1, i + 1))}
                >
                  Next section
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {script.adaptationCues.length > 0 && (
        <details className={styles.adaptation}>
          <summary>Adapting this guide</summary>
          <ul>
            {script.adaptationCues.map((cue, index) => (
              <li key={index}>{cue}</li>
            ))}
          </ul>
        </details>
      )}
      <div className={styles.progress}>
        <span role="status">
          {count} of {steps.length} guide sections reviewed
        </span>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${(count / steps.length) * 100}%` }} />
        </div>
      </div>
      {count === steps.length && (
        <p className={styles.completion} role="status">
          Your guide review is complete. Record only the work actually delivered in the session
          note.
        </p>
      )}
      <p className={styles.footnote} id={statusId}>
        Review markers apply only to this open guide. They do not save a clinical event, advance
        therapy, assign homework or share anything with the client.
      </p>
    </section>
  );
}
