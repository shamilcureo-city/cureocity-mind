'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TherapyScriptV1 } from '@cureocity/contracts';
import { Button } from '@/components/ui/Button';
import { mindGuideSteps, reviewedGuideCount } from '@/lib/mind-guidance';
import { useMindGuideReview, type MindGuideReviewTarget } from '@/lib/use-mind-guide-review';
import styles from './MindTherapyGuide.module.css';

export interface PreparedMindGuide {
  id: string;
  body: TherapyScriptV1;
  updatedAt: string;
}

/** Read-only, clinician-led use of an existing AI draft. No generated steps,
 * diagnoses, signed records or delivered interventions are inferred here. */
export function MindTherapyGuide({
  script,
  reviewTarget,
}: {
  script: TherapyScriptV1;
  reviewTarget?: MindGuideReviewTarget;
}) {
  const steps = useMemo(() => mindGuideSteps(script), [script]);
  const [mode, setMode] = useState<'guided' | 'overview'>('overview');
  const [reviewedForUse, setReviewedForUse] = useState(false);
  const {
    activeIndex,
    reviewed,
    setActiveIndex,
    toggleReviewed,
    saveStatus,
    canEdit,
    reload,
    retry,
  } = useMindGuideReview(steps, reviewTarget);
  const statusId = useId();
  const headingId = useId();
  const jumpMenu = useRef<HTMLDetailsElement>(null);
  const guideHeading = useRef<HTMLHeadingElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const focusNextSection = useRef(false);
  const active = steps[activeIndex] ?? steps[0]!;
  const count = reviewedGuideCount(steps, reviewed);
  const hasPlace = activeIndex > 0 || count > 0;
  const needsRecovery = ['load-error', 'save-error', 'conflict', 'stale'].includes(saveStatus);
  const saveMessage = {
    local: 'Your place and review markers stay in this open guide only.',
    loading: 'Loading saved review progress. You can keep reading.',
    ready: 'No saved review progress for this draft yet.',
    saving: 'Saving your place. Review markers update after the save is confirmed.',
    saved: 'Your place and review markers are saved for this draft version.',
    stale: 'This draft has changed. Close and reopen the guide to review its current content.',
    conflict: 'Saved progress changed in another view. Reload before marking more sections.',
    'load-error':
      'Saved progress could not be loaded. Your place is not being saved. Reload to try again.',
    'save-error':
      'The last save could not be confirmed. Retry save, or reload to discard the unconfirmed change.',
  }[saveStatus];

  useEffect(() => {
    if (focusNextSection.current && mode === 'guided' && reviewedForUse) {
      stepHeading.current?.focus();
      focusNextSection.current = false;
    }
  }, [activeIndex, mode, reviewedForUse]);

  function openGuided() {
    focusNextSection.current = true;
    setMode('guided');
  }

  function goToSection(index: number) {
    if (jumpMenu.current) jumpMenu.current.open = false;
    if (index === activeIndex) {
      stepHeading.current?.focus();
      return;
    }
    focusNextSection.current = true;
    setActiveIndex(index);
  }

  return (
    <section className={styles.guide} aria-label="Psychologist session guide">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your session companion</p>
          <h2 className={styles.title} ref={guideHeading} tabIndex={-1}>
            {script.therapyName}
          </h2>
          <p className={styles.meta}>
            AI-drafted guidance. Not a reviewed protocol. Adapt to the client.
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
          <button
            type="button"
            disabled={!reviewedForUse}
            aria-pressed={mode === 'guided' && reviewedForUse}
            onClick={openGuided}
            aria-describedby={statusId}
          >
            Step by step
          </button>
        </div>
      </header>

      <div className={styles.orientation} data-recovery={needsRecovery}>
        <div className={styles.place}>
          <div>
            <p className={styles.label}>
              {reviewTarget && saveStatus === 'saved' ? 'Saved place' : 'Current place'}
            </p>
            <p className={styles.placeTitle}>
              Section {activeIndex + 1} of {steps.length}: {active.title}
            </p>
          </div>
          <p className={styles.reviewCount}>
            {count} of {steps.length} guide sections reviewed
          </p>
        </div>
        <div className={styles.saveState}>
          <p role="status">{saveMessage}</p>
          {saveStatus === 'save-error' && (
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry save
            </Button>
          )}
          {['load-error', 'save-error', 'conflict'].includes(saveStatus) && (
            <Button variant="secondary" size="sm" onClick={reload}>
              Reload saved progress
            </Button>
          )}
        </div>
      </div>

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
        {reviewedForUse && mode === 'overview' && (
          <Button className={styles.openGuide} onClick={openGuided}>
            {hasPlace ? `Continue at section ${activeIndex + 1}` : 'Open step-by-step guide'}
          </Button>
        )}
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
        </div>
      ) : (
        <div className={styles.journey}>
          <details className={styles.path} ref={jumpMenu}>
            <summary>Jump to a section</summary>
            <nav aria-label="Guide sections">
              <ol>
                {steps.map((step, index) => (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => goToSection(index)}
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
                        {reviewed.has(step.id) && (
                          <span className={styles.reviewedLabel}>Reviewed</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          </details>
          <section className={styles.stepBody} aria-labelledby={headingId}>
            <p className={styles.label}>
              Section {activeIndex + 1} of {steps.length}
            </p>
            <h3 id={headingId} ref={stepHeading} tabIndex={-1}>
              {active.title}
            </h3>
            <p className={styles.sectionHint}>
              Suggested wording — adapt it, pause or skip as needed.
            </p>
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
                disabled={!canEdit}
                aria-pressed={reviewed.has(active.id)}
                aria-describedby={statusId}
              >
                {reviewed.has(active.id) ? 'Undo reviewed marker' : 'Mark section reviewed'}
              </Button>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={activeIndex === 0}
                  onClick={() => goToSection(Math.max(0, activeIndex - 1))}
                >
                  Previous section
                </Button>
                {activeIndex < steps.length - 1 ? (
                  <Button
                    size="sm"
                    aria-label={`Next section: ${steps[activeIndex + 1]!.title}`}
                    onClick={() => goToSection(activeIndex + 1)}
                  >
                    Next section
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setMode('overview');
                      guideHeading.current?.focus();
                    }}
                  >
                    Return to overview
                  </Button>
                )}
              </div>
            </div>
            <p className={styles.navigationNote}>
              Moving between sections does not mark them reviewed or record therapy delivery.
            </p>
          </section>
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
      {count === steps.length && (
        <p className={styles.completion} role="status">
          Your guide review is complete. Record only the work actually delivered in the session
          note.
        </p>
      )}
      <p className={styles.footnote} id={statusId}>
        {reviewTarget
          ? 'Review markers and your place can be saved for this version of the guide. Review suitability again for each use. '
          : 'Review markers apply only to this open guide. '}
        They do not save a clinical event, advance therapy, assign homework or share anything with
        the client.
      </p>
    </section>
  );
}
