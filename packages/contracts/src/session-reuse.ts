/**
 * Sprint TS3 (F1) — "start now" session reuse.
 *
 * When a therapist starts a session for a client who already has a
 * SCHEDULED/IN_PROGRESS session booked for the same IST day, the create
 * route must reuse that row rather than mint a duplicate at `now` (which
 * orphaned the booked slot — the F1 dead-end). This mirrors the doctor
 * clinic queue, which reuses the pre-minted encounter (with its OPD token)
 * on start and only mints for walk-ins.
 *
 * The IST-day window + candidate query live in the route (they need the DB);
 * the *decision* of which candidate to reuse is this pure, dependency-free
 * function so it can be unit-tested without a database.
 */

/** The minimal session shape the reuse decision needs. */
export interface ReusableSessionCandidate {
  status: string;
  scheduledAt: Date;
}

/**
 * Pick the session a "start now" create should reuse, or `null` to mint a
 * fresh row. Reuses the EARLIEST still-open (SCHEDULED or IN_PROGRESS)
 * session scheduled within `[range.start, range.end)`. COMPLETED / NO_SHOW /
 * CANCELLED / RESCHEDULED rows and anything outside the day window are
 * ignored — a client seen earlier today and completed still gets a fresh
 * session for the new visit.
 */
export function selectReusableSession<T extends ReusableSessionCandidate>(
  candidates: readonly T[],
  range: { start: Date; end: Date },
): T | null {
  const open = candidates.filter(
    (c) =>
      (c.status === 'SCHEDULED' || c.status === 'IN_PROGRESS') &&
      c.scheduledAt.getTime() >= range.start.getTime() &&
      c.scheduledAt.getTime() < range.end.getTime(),
  );
  if (open.length === 0) return null;
  return open.reduce((earliest, c) =>
    c.scheduledAt.getTime() < earliest.scheduledAt.getTime() ? c : earliest,
  );
}
