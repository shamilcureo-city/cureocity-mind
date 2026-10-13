import Link from 'next/link';
import type { ReactNode } from 'react';
import type { JourneySummary } from '@cureocity/contracts';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buildMindClientOverview } from '@/lib/mind-client-overview';
import { clientSessionSummary } from '@/lib/client-session-summary';
import {
  mindSessionDestination,
  mindStartEntryHref,
  type MindCaptureMode,
} from '@/lib/mind-session-start';
import { formatIstDateTime } from '@/lib/ist';
import styles from './MindClientOverview.module.css';

export interface MindOverviewSession {
  id: string;
  status: string;
  scheduledAt: Date;
  modality: string | null;
  captureMode?: string | null;
  mindDocumentationMode?: string | null;
  therapyNote: { id: string; locked: boolean; signedAt: Date | string } | null;
  noteDraft: { status: string } | null;
}

/** Presentation only: every clinical value is supplied by the tenant-scoped page. */
export interface MindClientOverviewProps {
  clientId: string;
  name: string;
  age: number | null;
  createdAt: Date;
  isDemo: boolean;
  presentingConcerns: string | null;
  journey: JourneySummary;
  sessions: readonly MindOverviewSession[];
  activeHomeworkCount: number;
  defaultCapture: MindCaptureMode;
  now?: Date;
  safetyBanner?: ReactNode;
  scheduleAction?: ReactNode;
  clientSettings?: ReactNode;
  contactDetails?: ReactNode;
  navigation?: ReactNode;
  preparationPanel?: ReactNode;
  children?: ReactNode;
}

export function MindClientOverview({
  clientId,
  name,
  age,
  createdAt,
  isDemo,
  presentingConcerns,
  journey,
  sessions,
  activeHomeworkCount,
  defaultCapture,
  now,
  safetyBanner,
  scheduleAction,
  clientSettings,
  contactDetails,
  navigation,
  preparationPanel,
  children,
}: MindClientOverviewProps) {
  const {
    latestCompletedSession,
    nextAppointment,
    recentSessions,
    completedCount,
    totalRecordCount,
  } = buildMindClientOverview(sessions, now);
  const activeSession = [...sessions]
    .filter((session) => session.status === 'IN_PROGRESS')
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];
  const entrySession = activeSession ?? nextAppointment;
  const entryHref = entrySession
    ? mindSessionDestination({ ...entrySession, clientId }, defaultCapture)
    : mindStartEntryHref({ source: 'CLIENT', clientId, captureMode: defaultCapture });
  const entryLabel = activeSession
    ? activeSession.mindDocumentationMode === 'MANUAL'
      ? 'Continue note'
      : 'Continue session'
    : 'Prepare session';
  const base = `/app/clients/${encodeURIComponent(clientId)}`;
  const plan = journey.activePlan;
  const primaryGoal = plan?.goals.find((goal) => goal.status !== 'ACHIEVED') ?? plan?.goals[0];
  const timeline = [
    { label: 'Client record opened', at: createdAt },
    ...(plan ? [{ label: 'Current plan confirmed', at: new Date(plan.confirmedAt) }] : []),
    ...(latestCompletedSession
      ? [{ label: 'Last completed session', at: latestCompletedSession.scheduledAt }]
      : []),
    ...(nextAppointment ? [{ label: 'Next booked session', at: nextAppointment.scheduledAt }] : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className={`mind-visual-workspace ${styles.overview}`}>
      <Link href="/app/clients" className={styles.backLink}>
        <span aria-hidden="true">←</span> All clients
      </Link>
      {safetyBanner}
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(name)}
          </span>
          <div className={styles.nameBlock}>
            <h1>{name || 'Name unavailable'}</h1>
            <p>
              {age !== null ? `${age} years` : 'Age not recorded'}
              <span aria-hidden="true"> · </span>Client since {dateLabel(createdAt)}
            </p>
            {!name && <Badge tone="warn">Contact support to restore name</Badge>}
            {isDemo && <Badge tone="warn">Example client</Badge>}
          </div>
        </div>
        <div className={styles.headerActions}>
          {scheduleAction}
          <ButtonLink href={entryHref} className={styles.primaryAction}>
            {entryLabel}
            <span aria-hidden="true">→</span>
          </ButtonLink>
        </div>
      </header>
      {isDemo && (
        <p className={styles.demoNotice}>
          This client is a fabricated example. Their records do not count toward your trial
          allowance or practice metrics.
        </p>
      )}
      {navigation}
      {(clientSettings || contactDetails) && (
        <div className={styles.detailsRow}>
          {contactDetails}
          {clientSettings}
        </div>
      )}

      <div className={styles.overviewGrid}>
        <div className={styles.mainColumn}>
          <Card className={styles.continuity}>
            <div className={styles.panelEyeline}>
              <span className={styles.careLabel}>
                <CareLeaf />
                The thread of care
              </span>
              {plan && <span>Plan confirmed {dateLabel(new Date(plan.confirmedAt))}</span>}
            </div>
            <h2>{primaryGoal?.description || 'Room to understand what matters.'}</h2>
            <p className={styles.contextCopy}>
              {primaryGoal
                ? 'A goal from the confirmed care plan, not a measure of recovery. Check what matters to the client today.'
                : 'Build a shared understanding at the client’s pace. A diagnosis or care plan is not required to begin counselling.'}
            </p>
            {presentingConcerns?.trim() && (
              <details className={styles.concerns}>
                <summary>Presenting concerns</summary>
                <p>{presentingConcerns.trim()}</p>
              </details>
            )}
            <ol className={styles.timeline} aria-label="Recorded care milestones">
              {timeline.map((event, index) => (
                <li key={event.label}>
                  <span
                    className={`${styles.timelineDot} ${index === timeline.length - 1 ? styles.latestDot : ''}`}
                    aria-hidden="true"
                  />
                  <time dateTime={event.at.toISOString()}>{dateLabel(event.at)}</time>
                  <span>{event.label}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card className={styles.conversation}>
            <div className={styles.sectionHeading}>
              <h2>For the next conversation</h2>
              {activeSession && <Badge tone="warn">Unfinished session</Badge>}
            </div>
            <p className={styles.appointment}>
              {nextAppointment ? (
                <>
                  <span>Next appointment</span>
                  <time dateTime={nextAppointment.scheduledAt.toISOString()}>
                    {formatIstDateTime(nextAppointment.scheduledAt)} IST
                  </time>
                </>
              ) : (
                'No next appointment booked.'
              )}
            </p>
            <div className={styles.suggestion}>
              <span className={styles.suggestionIcon} aria-hidden="true">
                ☷
              </span>
              <div>
                <h3>{journey.nextBestAction?.title ?? 'Agree together on today’s focus'}</h3>
                <p>
                  {journey.nextBestAction?.detail ??
                    'Begin with what has changed and what the client would like from this conversation.'}
                </p>
              </div>
            </div>
            {journey.nextBestAction && (
              <p className={styles.sourceNote}>
                Record-based suggestion for clinician review. It is not a required action or a
                confirmed clinical outcome.
              </p>
            )}
            <div className={styles.sessionContext}>
              <span>
                {latestCompletedSession
                  ? `Last completed: ${dateLabel(latestCompletedSession.scheduledAt)}`
                  : 'No completed session yet'}
              </span>
              <span>
                {activeHomeworkCount > 0
                  ? `${activeHomeworkCount === 3 ? 'At least ' : ''}${activeHomeworkCount} active practice assignment${activeHomeworkCount === 1 ? '' : 's'}`
                  : 'No active practice assignments'}
              </span>
            </div>
            <Link className={styles.textLink} href="#prepare">
              Open the preparation brief <span aria-hidden="true">→</span>
            </Link>
            {activeSession && (
              <p className={styles.sourceNote}>
                An unfinished record does not mean a microphone is recording now. Continue it before
                creating another session.
              </p>
            )}
          </Card>

          <Card className={styles.sessions}>
            <div className={styles.sectionHeading}>
              <h2>Recent sessions</h2>
              <Link className={styles.textLink} href={`${base}/sessions`}>
                View all
              </Link>
            </div>
            <p className={styles.sourceNote}>
              {completedCount} completed session{completedCount === 1 ? '' : 's'};{' '}
              {totalRecordCount} total appointments and session records.
            </p>
            {recentSessions.length === 0 ? (
              <p className={styles.emptyState}>
                No recent session records yet. Prepare a session when you and the client are ready.
              </p>
            ) : (
              <ul className={styles.sessionList}>
                {recentSessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={mindSessionDestination({ ...session, clientId }, defaultCapture)}
                      className={styles.sessionLink}
                    >
                      <time
                        className={styles.dateTile}
                        dateTime={session.scheduledAt.toISOString()}
                      >
                        <strong>
                          {session.scheduledAt.toLocaleDateString('en-IN', {
                            day: '2-digit',
                            timeZone: 'Asia/Kolkata',
                          })}
                        </strong>
                        <span>
                          {session.scheduledAt.toLocaleDateString('en-IN', {
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'Asia/Kolkata',
                          })}
                        </span>
                      </time>
                      <div>
                        <h3>{sessionTitle(session.modality)}</h3>
                        <p>
                          {clientSessionSummary(
                            session.status,
                            session.therapyNote,
                            session.noteDraft,
                          )}
                        </p>
                        <span className={styles.recordStatus}>
                          {session.status.replaceAll('_', ' ').toLowerCase()}
                        </span>
                      </div>
                      <span className={styles.openArrow} aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className={styles.sideColumn} aria-label="Recorded goals and check-ins">
          <Card className={styles.checkins}>
            <h2>Recorded check-ins</h2>
            <p className={styles.sourceNote}>Baseline and latest questionnaire scores.</p>
            {journey.instrumentChanges.length === 0 ? (
              <p className={styles.emptyState}>
                There are not yet two recorded responses to compare. Open the care journey to review
                or add a check-in if appropriate.
              </p>
            ) : (
              <div className={styles.measures}>
                {journey.instrumentChanges.map((measure) => {
                  const max = measure.instrumentKey === 'GAD7' ? 21 : 27;
                  const label = measure.instrumentKey === 'GAD7' ? 'GAD-7' : 'PHQ-9';
                  return (
                    <section
                      key={measure.instrumentKey}
                      aria-label={`${label} recorded comparison`}
                    >
                      <h3>{label}</h3>
                      <div className={styles.measureRows}>
                        {[
                          {
                            label: 'Baseline',
                            score: measure.baselineScore,
                            at: measure.baselineAt,
                          },
                          { label: 'Latest', score: measure.latestScore, at: measure.latestAt },
                        ].map((reading) => (
                          <div key={reading.label} className={styles.measureRow}>
                            <div className={styles.measureLabel}>
                              <span>{reading.label}</span>
                              <time dateTime={reading.at}>{dateLabel(new Date(reading.at))}</time>
                              <strong>
                                {reading.score}/{max}
                              </strong>
                            </div>
                            <div className={styles.barTrack} aria-hidden="true">
                              <span
                                className={
                                  reading.label === 'Latest' ? styles.latestBar : styles.baselineBar
                                }
                                style={{ width: `${Math.min(100, (reading.score / max) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <Link
                        className={styles.textLink}
                        href={`${base}/journey#measure-${measure.instrumentKey.toLowerCase()}`}
                      >
                        Review {label} check-ins <span aria-hidden="true">→</span>
                      </Link>
                    </section>
                  );
                })}
              </div>
            )}
            <p className={styles.measureCaveat}>
              Scores are conversation context. They do not establish a diagnosis or confirm
              recovery.
            </p>
            {journey.instrumentChanges.length === 0 && (
              <Link className={styles.textLink} href={`${base}/journey`}>
                Open care journey <span aria-hidden="true">→</span>
              </Link>
            )}
          </Card>

          <Card className={styles.goals}>
            <svg className={styles.goalMark} viewBox="0 0 40 40" aria-hidden="true">
              <path
                d="M20 1v38M1 20h38M7 7l26 26M7 33 33 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            <h2>
              What we’re
              <br />
              working toward
            </h2>
            {plan ? (
              <>
                <p className={styles.sourceNote}>
                  Care plan confirmed {dateLabel(new Date(plan.confirmedAt))}.
                </p>
                {plan.goals.length > 0 ? (
                  <ul className={styles.goalList}>
                    {plan.goals.map((goal) => (
                      <li key={goal.index}>
                        <h3>{goal.description}</h3>
                        <p>{goal.measure}</p>
                        <span>{goalStatusLabel(goal.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyState}>No goals have been recorded in this plan yet.</p>
                )}
              </>
            ) : (
              <p className={styles.emptyState}>
                No confirmed care plan yet. Agree goals together when it is useful; a plan is not
                required to begin counselling.
              </p>
            )}
            <Link href={`${base}/plan`} className={styles.textLink}>
              Review care plan <span aria-hidden="true">→</span>
            </Link>
          </Card>
          <div className={styles.safetyContext}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m12 3 7 3v6c0 5-7 9-7 9s-7-4-7-9V6l7-3Zm0 5v5m0 3v.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <h3>Keep safety in view</h3>
              <p>
                Review recorded concerns and check what has changed today. Previous notes are not a
                current safety assessment.
              </p>
              <Link href={`${base}/journey`} className={styles.textLink}>
                Open safety and care context
              </Link>
            </div>
          </div>
        </aside>
      </div>
      <section id="prepare" className={styles.preparation} aria-labelledby="client-prepare-heading">
        <h2 id="client-prepare-heading">Prepare for the next session</h2>
        {preparationPanel}
      </section>
      {children}
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toLocaleUpperCase() || '?'
  );
}

function dateLabel(at: Date) {
  return at.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function goalStatusLabel(status: string) {
  if (status === 'ACHIEVED') return 'Recorded as achieved';
  if (status === 'NOT_STARTED') return 'Not started';
  return 'Ongoing';
}

function sessionTitle(modality: string | null) {
  if (!modality || modality === 'OTHER') return 'Session record';
  const labels: Record<string, string> = {
    SUPPORTIVE: 'Supportive',
    INTAKE: 'Assessment',
    PSYCHODYNAMIC: 'Psychodynamic',
    MI: 'Motivational interviewing',
  };
  return `${labels[modality] ?? modality.replaceAll('_', ' ')} session`;
}

function CareLeaf() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M19 4c-9-1-14 3-13 9 1 6 12 5 13-9ZM5 21c0-5 5-10 9-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
