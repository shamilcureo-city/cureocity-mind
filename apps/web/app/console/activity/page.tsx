import Link from 'next/link';
import {
  AdminCard,
  AdminPageHeader,
  StatGrid,
  StatTile,
  Table,
  Td,
  Thead,
  Tr,
} from '@/components/console/AdminUI';
import { requirePageAdmin } from '@/lib/auth-page';
import {
  buildSyntheticActivityCalendar,
  normalizeSyntheticActivityDate,
  syntheticActivityMonthGrid,
  syntheticActivityQueryRange,
  type CohortActivityStats,
} from '@/lib/demo-activity';
import { DEMO_LOAD_PRACTITIONER_UID_PREFIX } from '@/lib/demo-load-plan';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function DemoActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  await requirePageAdmin();
  const selectedDate = normalizeSyntheticActivityDate((await searchParams).day);
  const { from, to } = syntheticActivityQueryRange();
  const [practitioners, sessions] = await Promise.all([
    prisma.psychologist.findMany({
      where: {
        isSynthetic: true,
        firebaseUid: { startsWith: DEMO_LOAD_PRACTITIONER_UID_PREFIX },
        deletedAt: null,
      },
      orderBy: [{ vertical: 'asc' }, { fullName: 'asc' }, { id: 'asc' }],
      select: { id: true, fullName: true, vertical: true },
    }),
    prisma.session.findMany({
      where: {
        status: { in: ['COMPLETED', 'SCHEDULED'] },
        scheduledAt: { gte: from, lt: to },
        psychologist: {
          isSynthetic: true,
          firebaseUid: { startsWith: DEMO_LOAD_PRACTITIONER_UID_PREFIX },
          deletedAt: null,
        },
      },
      select: { psychologistId: true, scheduledAt: true },
    }),
  ]);
  const calendar = buildSyntheticActivityCalendar(practitioners, sessions);
  const selected = calendar.days.find((day) => day.date === selectedDate)!;
  const byDate = new Map(calendar.days.map((day) => [day.date, day]));

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Demo activity"
        description="A fixed September 2026 view of generated Scribe and Mind sessions, grouped by each cohort’s local calendar day."
      />

      <section
        className="mb-6 rounded-xl border border-[var(--color-line)] bg-white/70 px-5 py-4 text-[var(--color-ink-2)]"
        aria-label="Demo data notice"
      >
        <div className="flex items-start gap-3">
          <div>
            <p className="font-semibold text-[var(--color-ink)]">Demo data</p>
            <p className="mt-1 max-w-4xl text-sm leading-6">
              Fictional practitioner profiles and generated sessions for product demonstration — not
              real clinicians, credentials, customers, patients, or clinical activity.
            </p>
          </div>
        </div>
      </section>

      <StatGrid>
        <StatTile
          label="Demo Scribe sessions"
          value={formatNumber(calendar.doctor.totalSessions)}
          sub={`${calendar.doctor.activePractitioners}/${calendar.doctor.practitionerCount} active UAE doctors`}
        />
        <StatTile
          label="Demo Mind sessions"
          value={formatNumber(calendar.psychologist.totalSessions)}
          sub={`${calendar.psychologist.activePractitioners}/${calendar.psychologist.practitionerCount} active Indian psychologists`}
        />
        <StatTile
          label="Demo combined sessions"
          value={formatNumber(calendar.totalSessions)}
          sub="1–30 September 2026"
          tone="accent"
        />
        <StatTile
          label="Demo practitioners"
          value={formatNumber(
            calendar.doctor.practitionerCount + calendar.psychologist.practitionerCount,
          )}
          sub="Never included as real customer proof"
          tone="warn"
        />
      </StatGrid>

      <AdminCard
        title="September 2026"
        hint="Doctor dates use Gulf Standard Time (UTC+4); psychologist dates use India Standard Time (UTC+5:30). Select a day for its distribution."
        className="mt-6"
      >
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[840px] grid-cols-7 border-l border-t border-[var(--color-line-soft)]">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="border-b border-r border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-2 py-2 text-center text-xs font-medium text-[var(--color-ink-3)]"
              >
                {weekday}
              </div>
            ))}
            {syntheticActivityMonthGrid().map((date, index) => {
              if (!date) {
                return (
                  <div
                    key={`blank-${index}`}
                    aria-hidden
                    className="min-h-[116px] border-b border-r border-[var(--color-line-soft)] bg-white/30"
                  />
                );
              }
              const day = byDate.get(date)!;
              const selectedDay = date === selectedDate;
              return (
                <Link
                  key={date}
                  href={`/console/activity?day=${date}`}
                  scroll={false}
                  aria-label={`${longDate(date)}: ${day.doctor.totalSessions} doctor sessions and ${day.psychologist.totalSessions} psychologist sessions`}
                  aria-current={selectedDay ? 'date' : undefined}
                  className={`min-h-[116px] border-b border-r p-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] ${
                    selectedDay
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-line-soft)] bg-white/70 hover:bg-white'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="font-serif text-lg leading-none">
                      {Number(date.slice(-2))}
                    </span>
                    <span className="text-[10px] tabular-nums text-[var(--color-ink-3)]">
                      {formatNumber(day.totalSessions)} total
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <CalendarCount
                      label="Scribe"
                      sessions={day.doctor.totalSessions}
                      active={day.doctor.activePractitioners}
                      tone="doctor"
                    />
                    <CalendarCount
                      label="Mind"
                      sessions={day.psychologist.totalSessions}
                      active={day.psychologist.activePractitioners}
                      tone="psychologist"
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </AdminCard>

      <section className="mt-6" aria-labelledby="selected-activity-day">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="selected-activity-day" className="font-serif text-2xl">
              {longDate(selectedDate)}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-3)]">
              Per-practitioner distribution includes zero-session demo accounts.
            </p>
          </div>
          <p className="text-sm tabular-nums text-[var(--color-ink-2)]">
            {formatNumber(selected.totalSessions)} generated sessions
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CohortDetail
            title="Demo Scribe · UAE doctors"
            timezone="Gulf Standard Time"
            stats={selected.doctor}
            tone="doctor"
          />
          <CohortDetail
            title="Demo Mind · Indian psychologists"
            timezone="India Standard Time"
            stats={selected.psychologist}
            tone="psychologist"
          />
        </div>
      </section>
    </>
  );
}

function CalendarCount({
  label,
  sessions,
  active,
  tone,
}: {
  label: string;
  sessions: number;
  active: number;
  tone: 'doctor' | 'psychologist';
}) {
  const colors = tone === 'doctor' ? 'bg-[#e9f2fb] text-[#244e78]' : 'bg-[#f2ebfa] text-[#62408a]';
  return (
    <div className={`rounded-md px-2 py-1.5 ${colors}`}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{formatNumber(sessions)}</span>
      </div>
      <p className="text-[9px] opacity-75">{active} active</p>
    </div>
  );
}

function CohortDetail({
  title,
  timezone,
  stats,
  tone,
}: {
  title: string;
  timezone: string;
  stats: CohortActivityStats;
  tone: 'doctor' | 'psychologist';
}) {
  const accent = tone === 'doctor' ? 'text-[#244e78]' : 'text-[#62408a]';
  return (
    <AdminCard title={title} hint={timezone}>
      <div className="grid grid-cols-2 gap-3 border-b border-[var(--color-line-soft)] pb-4 sm:grid-cols-5">
        <MiniStat label="Sessions" value={formatNumber(stats.totalSessions)} accent={accent} />
        <MiniStat
          label="Active"
          value={`${stats.activePractitioners}/${stats.practitionerCount}`}
          accent={accent}
        />
        <MiniStat label="Minimum" value={formatMetric(stats.min)} />
        <MiniStat label="Median" value={formatMetric(stats.median)} />
        <MiniStat label="Maximum" value={formatMetric(stats.max)} />
      </div>
      <div className="mt-4">
        <Table>
          <Thead
            cols={[{ label: 'Highest demo activity' }, { label: 'Sessions', align: 'right' }]}
          />
          <tbody>
            {stats.top.map((row) => (
              <Tr key={row.practitionerId}>
                <Td>{row.practitionerName}</Td>
                <Td align="right" nums>
                  {formatNumber(row.sessions)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </AdminCard>
  );
}

function MiniStat({
  label,
  value,
  accent = '',
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-[var(--color-ink-3)]">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function longDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? formatNumber(value) : value.toFixed(1);
}
