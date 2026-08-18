import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function route(relative: string): string {
  return readFileSync(resolve(process.cwd(), 'app/api/v1', relative, 'route.ts'), 'utf8');
}

describe('session lifecycle route concurrency architecture', () => {
  it.each([
    'sessions/[id]/start',
    'sessions/[id]/live-token',
    'sessions/[id]/consent',
    'clients/[id]/dsr/consent-withdrawal',
  ])('serializes %s on the shared client consent row lock', (path) => {
    expect(route(path)).toContain('withClientConsentLock(');
  });

  it('authorizes and signs live tokens inside the same locked transaction', () => {
    const source = route('sessions/[id]/live-token');
    const lock = source.indexOf('withClientConsentLock(');
    const authorization = source.indexOf('assertLiveTokenSessionStatus(', lock);
    const token = source.indexOf('return signLiveToken(', authorization);

    expect(lock).toBeGreaterThan(-1);
    expect(authorization).toBeGreaterThan(lock);
    expect(token).toBeGreaterThan(authorization);
  });

  it.each(['sessions/[id]/start', 'sessions/[id]/live-token'])(
    'uses the centralized complete snapshot and standing-grant predicate in %s',
    (path) => {
      const source = route(path);
      const lock = source.indexOf('withClientConsentLock(');
      const authorization = source.indexOf('assertValidScribeConsent(', lock);

      expect(authorization).toBeGreaterThan(lock);
    },
  );

  it.each([
    ['sessions/[id]/reschedule', "expectedStatus: 'SCHEDULED'"],
    ['sessions/[id]/no-show/undo', "expectedStatus: 'NO_SHOW'"],
  ])('uses a conditional lifecycle transition in %s', (path, expectedStatus) => {
    const source = route(path);
    expect(source).toContain('conditionalSessionTransition(');
    expect(source).toContain(expectedStatus);
    expect(source).not.toContain('tx.session.update({');
  });

  it('creates a replacement only after reschedule wins the conditional transition', () => {
    const source = route('sessions/[id]/reschedule');
    expect(source.indexOf('conditionalSessionTransition(')).toBeLessThan(
      source.indexOf('tx.session.create('),
    );
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
  });

  it('locks a linked appointment before reschedule touches the session row', () => {
    const source = route('sessions/[id]/reschedule');
    const appointmentLock = source.indexOf('lockLinkedAppointmentForSession(');
    const sessionTransition = source.indexOf('conditionalSessionTransition(', appointmentLock);

    expect(appointmentLock).toBeGreaterThan(-1);
    expect(sessionTransition).toBeGreaterThan(appointmentLock);
  });

  it('cancels old-schedule reminder rows before moving the linked appointment', () => {
    const source = route('sessions/[id]/reschedule');
    const cancellation = source.indexOf('cancelAppointmentReminderDeliveriesForReschedule(');
    const appointmentUpdate = source.indexOf('tx.appointment.update({', cancellation);

    expect(cancellation).toBeGreaterThan(-1);
    expect(appointmentUpdate).toBeGreaterThan(cancellation);
    expect(source.slice(cancellation, appointmentUpdate)).toContain(
      'scheduledStartAt: linkedAppt.startAt',
    );
  });

  it('returns the stable conflict response when consent snapshot loses to start', () => {
    const source = route('sessions/[id]/consent');
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
    expect(source).toContain("expectedStatus: 'SCHEDULED'");
  });

  it.each(['sessions/[id]/consent', 'clients/[id]/dsr/consent-withdrawal'])(
    'does not treat expired grants as active in %s',
    (path) => {
      expect(route(path)).toContain('expiresAt: { gt: now }');
    },
  );

  it('conditionally cancels a linked scheduled session and maps a lost race to 409', () => {
    const source = route('public/appointments/[id]/cancel');

    expect(source).toContain('conditionalAppointmentTransition(');
    expect(source).toContain('cancelled.sessionId');
    expect(source).toContain('conditionalSessionTransition(');
    expect(source).toContain("expectedStatus: 'SCHEDULED'");
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
    expect(source).toContain('appointmentConcurrentModificationResponse(error)');
  });

  it.each(['public/appointments/[id]/cancel', 'sessions/[id]/reschedule'])(
    'maps database concurrency aborts to a stable conflict in %s',
    (path) => {
      expect(route(path)).toContain('transactionConflictResponse(error)');
    },
  );

  it.each(['appointments/[id]/confirm', 'appointments/[id]/decline'])(
    'claims the requested appointment in %s and maps a lost race to 409',
    (path) => {
      const source = route(path);
      expect(source).toContain('conditionalAppointmentTransition(');
      expect(source).toContain("expectedStatus: 'REQUESTED'");
      expect(source).toContain('appointmentConcurrentModificationResponse(error)');
    },
  );

  it('selects both stale holds and already-started requests as expiry candidates', () => {
    const source = route('cron/appointments');

    expect(source).toMatch(
      /const expiryCandidates = await prisma\.appointment\.findMany\(\{[\s\S]*?OR:\s*\[\s*\{ createdAt: \{ lt: staleCutoff \} \},\s*\{ startAt: \{ lt: now \} \},?\s*\]/,
    );
    expect(source).toContain('for (const appt of expiryCandidates)');
  });

  it('claims every expiry candidate before transactional audit and post-commit effects', () => {
    const source = route('cron/appointments');
    const loop = source.indexOf('for (const appt of expiryCandidates)');
    const transaction = source.indexOf('await prisma.$transaction(async (tx) => {', loop);
    const claim = source.indexOf('conditionalAppointmentTransition(', transaction);
    const audit = source.indexOf("action: 'APPOINTMENT_EXPIRED'", claim);
    const transactionEnd = source.indexOf('\n      });', audit);
    const lostRace = source.indexOf(
      'if (error instanceof ConditionalAppointmentTransitionError) continue;',
      transactionEnd,
    );
    const increment = source.indexOf('expired++;', lostRace);
    const email = source.indexOf('sendAppointmentClosedEmail(', increment);

    expect(loop).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(loop);
    expect(claim).toBeGreaterThan(transaction);
    expect(source).toContain("expectedStatus: 'REQUESTED'");
    expect(audit).toBeGreaterThan(claim);
    expect(source.slice(audit, transactionEnd)).toMatch(/},\s*tx,?\s*\);/);
    expect(transactionEnd).toBeGreaterThan(audit);
    expect(lostRace).toBeGreaterThan(transactionEnd);
    expect(increment).toBeGreaterThan(lostRace);
    expect(email).toBeGreaterThan(increment);
    expect(source).not.toContain('expired: expiryCandidates.length');
  });

  it('has no direct appointment writer that cancels requested appointments', () => {
    const source = route('cron/appointments');

    expect(source).not.toMatch(
      /prisma\.appointment\.(?:update|updateMany)\s*\(\s*\{[\s\S]*?data:\s*\{\s*status:\s*'CANCELLED'/,
    );
  });

  it('upserts mutually exclusive 24-hour and 2-hour outbox windows', () => {
    const source = route('cron/appointments');

    expect(source).toContain("kind: 'H24'");
    expect(source).toContain("kind: 'H2'");
    expect(source).toContain('startAt: { gt: twoHourEnd, lte: twentyFourHourEnd }');
    expect(source).toContain('startAt: { gt: now, lte: twoHourEnd }');
    expect(source).toContain('appointmentId_scheduledStartAt_kind: {');
    expect(source).toContain('appointmentId: appt.id');
    expect(source).toContain('scheduledStartAt: appt.startAt');
    expect(source).toContain('providerIdempotencyKey(appt.id, appt.startAt, reminderKind)');
    expect(source).not.toContain("['reminded24At', 24]");
  });

  it('claims durable deliveries before dispatch and completes compatibility markers transactionally', () => {
    const source = route('cron/appointments');
    const claim = source.indexOf('claimAppointmentReminderDelivery(');
    const dispatch = source.indexOf('sendAppointmentReminderEmails(', claim);
    const complete = source.indexOf('completeAppointmentReminderDelivery(', dispatch);

    expect(claim).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(claim);
    expect(source.slice(dispatch, complete)).toContain('claimed.appointment.psychologistId');
    expect(source.slice(dispatch, complete)).toContain('claimed.appointment.startAt');
    expect(source.slice(dispatch, complete)).toContain('claimed.providerIdempotencyKey');
    expect(source.slice(dispatch, complete)).not.toContain('candidate.appointment.');
    expect(complete).toBeGreaterThan(dispatch);
    expect(source.slice(complete)).toContain('await prisma.$transaction(async (tx) =>');
  });

  it('persists provider failures for lease-backed retry without storing error detail', () => {
    const source = route('cron/appointments');
    const dispatch = source.indexOf('sendAppointmentReminderEmails(');
    const failed = source.indexOf('failAppointmentReminderDelivery(', dispatch);

    expect(failed).toBeGreaterThan(dispatch);
    expect(source).toContain("transient: result.outcome === 'transient_failure'");
    expect(source).toContain('code: result.errorCode');
    expect(source).not.toContain('error.message');
  });

  it('claims confirmation before creating any client or session side effects', () => {
    const source = route('appointments/[id]/confirm');
    const claim = source.indexOf('conditionalAppointmentTransition(');

    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(source.indexOf('tx.client.create('));
    expect(claim).toBeLessThan(source.indexOf('tx.session.create('));
  });
});
