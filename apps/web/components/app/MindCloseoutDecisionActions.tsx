'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import {
  confirmsMindCloseoutDecision,
  type MindCloseoutDecisionStep as DecisionStep,
  type MindCloseoutDecisionOutcome as DecisionOutcome,
} from '../../lib/mind-closeout-decision-receipt';
import styles from './MindCloseoutTasks.module.css';
import {
  MindCloseoutTaskBoundary,
  sameMindCloseoutTaskStatus,
  summarizeMindCloseoutTaskStatus,
  type MindCloseoutTaskReporter,
  type MindCloseoutTaskStatus,
} from '../../lib/mind-closeout-task-status';

type Task = 'work' | 'agreements' | 'appointment' | 'support' | 'decisions';
interface Props {
  sessionId: string;
  steps: MindSessionCloseout['steps'];
  canShare: boolean;
  clinicalReview?: ReactNode;
  canReviewClinical?: boolean;
  canRecordWork?: boolean;
  initialReviewOpen?: boolean;
  work?: ReactNode;
  agreements?: ReactNode;
  appointment?: ReactNode;
  agreementCount?: number;
  appointmentScheduled?: boolean;
}

const labels: Record<DecisionStep, string> = {
  clinicalSuggestions: 'Clinical suggestions',
  agreements: 'Agreements or homework',
  nextSessionQuestions: 'Next-session questions',
  shared: 'Client sharing',
};

/** One optional task at a time. Hiding a task never unmounts its loaded editor. */
export function MindCloseoutDecisionActions({
  sessionId,
  steps,
  canShare,
  clinicalReview,
  canReviewClinical = true,
  canRecordWork = false,
  initialReviewOpen = false,
  work,
  agreements,
  appointment,
  agreementCount = 0,
  appointmentScheduled = false,
}: Props) {
  const router = useRouter();
  const [activeTask, setActiveTask] = useState<Task | null>(
    initialReviewOpen && canReviewClinical ? 'support' : null,
  );
  const [reviewLoaded, setReviewLoaded] = useState(initialReviewOpen && canReviewClinical);
  const [savingStep, setSavingStep] = useState<DecisionStep | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DecisionStep, string>>>({});
  const [confirmed, setConfirmed] = useState<Partial<Record<DecisionStep, DecisionOutcome>>>({});
  const [taskStates, setTaskStates] = useState<
    Partial<Record<Task, Record<string, MindCloseoutTaskStatus>>>
  >({});
  const reportTaskStatus = useCallback<MindCloseoutTaskReporter>((task, source, status) => {
    setTaskStates((previous) => {
      if (status && sameMindCloseoutTaskStatus(previous[task]?.[source], status)) return previous;
      if (!status && !previous[task]?.[source]) return previous;
      const next = { ...previous[task] };
      if (status) next[source] = status;
      else delete next[source];
      return { ...previous, [task]: next };
    });
  }, []);
  const busy = useRef(false);
  const id = useId();
  const reviewOpen = activeTask === 'support';

  useEffect(() => {
    // Legacy deep links reveal the same mounted support, without writing a decision.
    if (initialReviewOpen && canReviewClinical) {
      setReviewLoaded(true);
      setActiveTask('support');
    }
  }, [initialReviewOpen, canReviewClinical]);

  function toggle(task: Task) {
    if (task === 'support') setReviewLoaded(true);
    setActiveTask((current) => (current === task ? null : task));
  }

  async function decide(step: DecisionStep, outcome: DecisionOutcome) {
    // The existing route requires clinical-analysis authority for every decision write.
    if (busy.current || !canReviewClinical || (step === 'shared' && !canShare)) return;
    busy.current = true;
    setSavingStep(step);
    setErrors((previous) => ({ ...previous, [step]: undefined }));
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/mind-closeout`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, outcome }),
        signal: AbortSignal.timeout(15_000),
      });
      const receipt: unknown = await response.json().catch(() => null);
      if (!response.ok || !confirmsMindCloseoutDecision(receipt, { sessionId, step, outcome }))
        throw new Error('The decision could not be confirmed.');
      setConfirmed((previous) => ({ ...previous, [step]: outcome }));
      router.refresh();
    } catch {
      // Keep independent acknowledgements. A failed optional decision never rolls back
      // a note, agreement, appointment, or a different confirmed decision.
      setErrors((previous) => ({
        ...previous,
        [step]: 'This decision could not be confirmed. Check its saved state before trying again.',
      }));
    } finally {
      busy.current = false;
      setSavingStep(null);
    }
  }

  const tasks: { key: Task; title: string; description: string; content: ReactNode }[] = [
    ...(canRecordWork && work
      ? [
          {
            key: 'work' as const,
            title: 'Work done & client response',
            description: 'Record what happened, in your own words.',
            content: work,
          },
        ]
      : []),
    ...(agreements
      ? [
          {
            key: 'agreements' as const,
            title: 'Agreements or homework',
            description: agreementCount
              ? `${agreementCount} ${agreementCount === 1 ? 'agreement saved' : 'agreements saved'}. Review or add an agreed step.`
              : 'Save only the practical steps you and the client agreed.',
            content: agreements,
          },
        ]
      : []),
    ...(appointment
      ? [
          {
            key: 'appointment' as const,
            title: 'The next appointment',
            description: appointmentScheduled
              ? 'A follow-up appointment is scheduled.'
              : 'Choose a time only if another visit is useful.',
            content: appointment,
          },
        ]
      : []),
    ...(canReviewClinical && clinicalReview
      ? [
          {
            key: 'support' as const,
            title: 'Session support',
            description: 'Evidence, diagnostic suggestions and next-session questions.',
            content: null,
          },
        ]
      : []),
    ...(canReviewClinical
      ? [
          {
            key: 'decisions' as const,
            title: 'Optional decision records',
            description: 'Record a review or an explicit “not needed” decision, if useful.',
            content: null,
          },
        ]
      : []),
  ];

  return (
    <div className="print:hidden">
      <p className={styles.intro}>
        Open one task at a time. Switching tasks keeps entries in this open page; save each task
        before leaving. Saving one does not save the others or send anything to the client.
      </p>
      <div className={styles.tasks}>
        {tasks.map((task) => {
          const status = summarizeMindCloseoutTaskStatus(taskStates[task.key]);
          return (
            <section
              key={task.key}
              className={styles.task}
              id={task.key === 'support' ? 'session-support' : undefined}
            >
              <h3>
                <button
                  type="button"
                  id={`${id}-${task.key}-trigger`}
                  className={styles.trigger}
                  aria-expanded={activeTask === task.key}
                  aria-controls={`${id}-${task.key}`}
                  onClick={() => toggle(task.key)}
                >
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.description}</small>
                    {(status.busy || status.uncertain || status.needsAttention || status.dirty) && (
                      <small className={styles.taskStatus}>
                        {status.busy
                          ? 'Saving…'
                          : status.uncertain
                            ? 'Save not confirmed'
                            : status.needsAttention
                              ? 'Needs attention'
                              : 'Unsaved changes'}
                      </small>
                    )}
                  </span>
                  <span className={styles.indicator} aria-hidden="true">
                    {activeTask === task.key ? '−' : '+'}
                  </span>
                </button>
              </h3>
              {task.key === 'support' ? (
                <section
                  id={`${id}-${task.key}`}
                  hidden={!reviewOpen}
                  className={styles.body}
                  aria-labelledby={`${id}-${task.key}-trigger`}
                >
                  {reviewLoaded && (
                    <>
                      <p className={styles.intro}>
                        Review only what is useful; opening this panel does not mark it reviewed. A
                        diagnosis, questionnaire or new plan is not required to finish a counselling
                        session.
                      </p>
                      {clinicalReview}
                    </>
                  )}
                </section>
              ) : (
                <section
                  id={`${id}-${task.key}`}
                  hidden={activeTask !== task.key}
                  className={styles.body}
                  aria-labelledby={`${id}-${task.key}-trigger`}
                >
                  {task.key === 'decisions' ? (
                    <>
                      <p className={styles.intro}>
                        Untouched options remain undecided. You do not need to record “not needed”
                        to finish your note. Skipping sharing does not revoke a link.
                      </p>
                      {(Object.keys(labels) as DecisionStep[])
                        .filter((step) => canShare || step !== 'shared')
                        .map((step) => {
                          // Saved agreements, selected questions and actual sharing are evidence,
                          // not toggle decisions. A later server receipt outranks a prior local skip.
                          const outcome =
                            step !== 'clinicalSuggestions' && steps[step] === 'COMPLETE'
                              ? 'COMPLETE'
                              : (confirmed[step] ?? steps[step]);
                          return (
                            <div
                              key={step}
                              className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] py-3 text-sm"
                            >
                              <p>
                                {labels[step]} ·{' '}
                                {outcome === 'PENDING'
                                  ? 'No decision recorded'
                                  : outcome === 'SKIPPED'
                                    ? 'Not needed this session'
                                    : 'Recorded'}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {step === 'clinicalSuggestions' && outcome !== 'COMPLETE' && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingStep !== null}
                                    onClick={() => void decide(step, 'COMPLETE')}
                                  >
                                    Record as reviewed
                                  </Button>
                                )}
                                {outcome !== 'SKIPPED' &&
                                  (outcome !== 'COMPLETE' || step === 'clinicalSuggestions') && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      disabled={savingStep !== null}
                                      onClick={() => void decide(step, 'SKIPPED')}
                                    >
                                      {step === 'shared'
                                        ? 'Record no sharing'
                                        : 'Record not needed'}
                                    </Button>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                    </>
                  ) : (
                    <MindCloseoutTaskBoundary task={task.key} onStatusChange={reportTaskStatus}>
                      {task.content}
                    </MindCloseoutTaskBoundary>
                  )}
                </section>
              )}
            </section>
          );
        })}
      </div>
      {tasks.map((task) => {
        const status = summarizeMindCloseoutTaskStatus(taskStates[task.key]);
        return status.busy || status.uncertain || status.needsAttention ? (
          <div
            key={task.key}
            role={status.needsAttention || status.uncertain ? 'alert' : 'status'}
            className={styles.notice}
          >
            <p>
              <strong>{task.title}:</strong>{' '}
              {status.busy
                ? 'A save is in progress.'
                : status.uncertain
                  ? 'A save could not be confirmed.'
                  : 'This task needs attention.'}{' '}
              {(status.needsAttention || status.uncertain) &&
                'Open this task to check the details. Other saved work is unchanged.'}
            </p>
            {activeTask !== task.key && (
              <button type="button" onClick={() => setActiveTask(task.key)}>
                Open {task.title.toLowerCase()}
              </button>
            )}
          </div>
        ) : null;
      })}
      {savingStep && (
        <p role="status" className="mt-4 text-sm">
          Saving {labels[savingStep].toLowerCase()} decision…
        </p>
      )}
      {Object.entries(errors)
        .filter(([, error]) => error)
        .map(([step, error]) => (
          <div key={step} role="alert" className={styles.notice}>
            <p>
              <strong>{labels[step as DecisionStep]}:</strong> {error} Other saved work is
              unchanged.
            </p>
            <button type="button" onClick={() => setActiveTask('decisions')}>
              Return to decision records
            </button>
          </div>
        ))}
    </div>
  );
}
