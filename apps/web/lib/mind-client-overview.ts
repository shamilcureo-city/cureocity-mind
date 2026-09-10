/** Appointment records are not proof of a completed session or saved recording. */
export function buildMindClientOverview<T extends { status: string; scheduledAt: Date }>(
  sessions: readonly T[],
  now = new Date(),
) {
  const newestFirst = [...sessions].sort(
    (a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime(),
  );
  return {
    totalRecordCount: sessions.length,
    completedCount: sessions.filter((session) => session.status === 'COMPLETED').length,
    latestCompletedSession: newestFirst.find((session) => session.status === 'COMPLETED'),
    nextAppointment: newestFirst
      .filter((session) => session.status === 'SCHEDULED' && session.scheduledAt >= now)
      .at(-1),
    recentSessions: newestFirst.filter((session) => session.status !== 'SCHEDULED').slice(0, 3),
  };
}
