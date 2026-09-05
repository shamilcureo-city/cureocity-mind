import type { ReactNode } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { TodaySessionCard, type TodaySessionCardProps } from './TodaySessionCard';
import { TodayAttentionQueue } from './TodayAttentionQueue';
import { MindTodayMilestones } from './MindTodayMilestones';
import type { buildMindTodayProgress } from './MindTodayProgress';
import type { TodayAttentionItem } from '@/lib/today-priority';
import { formatDayShort, formatIstTime } from '@/lib/ist';
import styles from './MindTodayStudio.module.css';

type Session = TodaySessionCardProps['session'];

export interface MindTodayWorkspaceProps {
  dateLabel: string;
  hero: Session | null;
  agenda: Array<{ session: Session; dueMeasure?: string | null }>;
  upcoming: Session[];
  attentionItems: readonly TodayAttentionItem[];
  defaultCapture: 'LIVE' | 'BATCH';
  progress: ReturnType<typeof buildMindTodayProgress>;
  firstRun?: ReactNode;
  actions?: ReactNode;
  preparation?: ReactNode;
}

/** Presentation only. The Today page owns authentication, capability checks and data. */
export function MindTodayWorkspace({
  dateLabel,
  hero,
  agenda,
  upcoming,
  attentionItems,
  defaultCapture,
  progress,
  firstRun,
  actions,
  preparation,
}: MindTodayWorkspaceProps) {
  return (
    <Container className={styles.studio}>
      <header className={styles.header}>
        <div>
          <p className={styles.date}>{dateLabel}</p>
          <h1 className={styles.title}>Your day, with room to focus.</h1>
          <p className={styles.intro}>
            Prepare for the person in front of you. Keep the next step clear.
          </p>
        </div>
        <div className={styles.actions}>{actions}</div>
      </header>

      {firstRun}
      <MindTodayMilestones progress={progress} />

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section aria-labelledby="next-session-heading">
            <div className={styles.sectionHeading}>
              <h2 id="next-session-heading">
                {hero?.status === 'IN_PROGRESS' ? 'Your session is open' : 'Your next session'}
              </h2>
              {hero && (
                <span>
                  {hero.status === 'IN_PROGRESS'
                    ? 'Pick up where you left off'
                    : 'A moment to prepare'}
                </span>
              )}
            </div>
            {hero ? (
              <TodaySessionCard
                session={hero}
                defaultCapture={defaultCapture}
                variant="hero"
                preparation={preparation}
              />
            ) : (
              <Card className={styles.empty}>
                <h3>Space for what comes next.</h3>
                <p>
                  No upcoming session is booked. Schedule a follow-up or start a walk-in when your
                  next client arrives. Any unfinished work stays in your attention list.
                </p>
                <Link href="/app/clients" className={styles.textLink}>
                  Open your clients
                </Link>
              </Card>
            )}
          </section>

          <section className={styles.agenda} aria-labelledby="agenda-heading">
            <div className={styles.sectionHeading}>
              <h2 id="agenda-heading">The rest of your day</h2>
              <span>
                {agenda.length} {agenda.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            {agenda.length > 0 ? (
              <ul className={styles.agendaList}>
                {agenda.map(({ session, dueMeasure }) => (
                  <li key={session.id}>
                    <TodaySessionCard
                      session={session}
                      defaultCapture={defaultCapture}
                      variant="row"
                      dueMeasure={dueMeasure}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.intro}>No other sessions on today’s agenda.</p>
            )}
          </section>
        </div>

        <TodayAttentionQueue items={attentionItems} />
      </div>

      <section className={styles.lookAhead} aria-labelledby="look-ahead-heading">
        <div className={styles.sectionHeading}>
          <h2 id="look-ahead-heading">A little further ahead</h2>
          <span>Next 3 days</span>
        </div>
        {upcoming.length === 0 ? (
          <p className={styles.intro}>
            No follow-ups booked in the next three days.{' '}
            <Link href="/app/clients" className={styles.textLink}>
              Open a client to plan one
            </Link>
          </p>
        ) : (
          <ul className={styles.futureList}>
            {upcoming.map((session) => (
              <li key={session.id}>
                <Link href={`/app/sessions/${session.id}`} className={styles.futureLink}>
                  <span>{formatDayShort(new Date(session.scheduledAt))}</span>
                  <span>
                    <b>{session.clientName}</b>
                    {session.modality && <small>{session.modality}</small>}
                  </span>
                  <time dateTime={session.scheduledAt}>
                    {formatIstTime(new Date(session.scheduledAt))}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}
