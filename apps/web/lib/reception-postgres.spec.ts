import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultReceptionSettings, type ReceptionRequestInput } from './reception';
import {
  actOnReceptionRequest,
  consumeReceptionRateLimit,
  loadPublicReception,
  loadReceptionWorkspace,
  saveReceptionSettings,
  submitReceptionRequest,
} from './reception-store';
import {
  acquireReceptionCalendarLock,
  assertReceptionCalendarAvailable,
} from './reception-calendar';
import { transferAllCustody, transferClientCustody } from './clinic';

// Real PostgreSQL transactions, fictional identities and encryption envelopes.
// These tests do not prove Firebase authentication, production KMS or delivery.
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: async (owner: string, value: string) =>
    `fixture:${owner}:${Buffer.from(value).toString('base64')}`,
  decryptForTenant: async (owner: string, value: string) =>
    value.startsWith(`fixture:${owner}:`)
      ? Buffer.from(value.slice(`fixture:${owner}:`.length), 'base64').toString()
      : null,
}));
vi.mock('./billing', () => ({ isBillingEnforced: () => false }));

function isolatedUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Explicit disposable reception database required');
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55442' ||
    url.pathname !== '/cureocity_mind_test' ||
    decodeURIComponent(url.username) !== 'reception_test_runtime' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Refusing a non-isolated reception database');
  }
  return url.toString();
}

it('refuses implicit, remote, owner-role and parameter-overridden database targets', () => {
  for (const url of [
    undefined,
    'postgresql://u:p@production.invalid/db',
    'postgresql://reception_test_owner:p@127.0.0.1:55442/cureocity_mind_test',
    'postgresql://reception_test_runtime:p@127.0.0.1:55442/cureocity_mind_test?host=other',
  ]) {
    expect(() => isolatedUrl(url)).toThrow();
  }
});

describe.skipIf(process.env['RUN_RECEPTION_POSTGRES_TESTS'] !== '1')(
  'Reception on disposable PostgreSQL',
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      const url = isolatedUrl(process.env['RECEPTION_TEST_DATABASE_URL']);
      if (globalThis.__cureocityPrisma)
        throw new Error('Refusing an existing application database client');
      db = new PrismaClient({ datasources: { db: { url } } });
      const proof = await db.$queryRaw<
        Array<{ role: string; database: string; safe: boolean; ready: boolean }>
      >`
      SELECT current_user::text AS role, current_database()::text AS database,
        (NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolbypassrls
          AND NOT r.rolreplication AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
          AND NOT pg_has_role(current_user, pg_get_userbyid(c.relowner), 'MEMBER')) AS safe,
        (EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261001000000_reception_pilot'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
          AND to_regclass('public.reception_requests') IS NOT NULL) AS ready
      FROM pg_roles r JOIN pg_class c ON c.oid = to_regclass('public.reception_settings')
      WHERE r.rolname = current_user
    `;
      if (
        proof.length !== 1 ||
        proof[0]?.role !== 'reception_test_runtime' ||
        proof[0].database !== 'cureocity_mind_test' ||
        !proof[0].safe ||
        !proof[0].ready
      ) {
        throw new Error(
          'Refusing fixture writes without restricted-role and migrated-schema proof',
        );
      }
      globalThis.__cureocityPrisma = db;
      vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
      vi.stubEnv('RECEPTION_RATE_LIMIT_SECRET', 'fictional-reception-test-secret-32-characters');
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('RECEPTION_TRUST_PROXY', 'false');
    });
    afterAll(async () => {
      globalThis.__cureocityPrisma = undefined;
      vi.unstubAllEnvs();
      await db?.$disconnect();
    });

    async function fixture(vertical: 'DOCTOR' | 'THERAPIST' = 'DOCTOR') {
      const id = `reception-test-${randomUUID()}`;
      const practitioner = await db.psychologist.create({
        data: {
          id,
          firebaseUid: id,
          email: `${id}@test.invalid`,
          fullName: 'Fictional practitioner',
          phone: id,
          rciNumber: id,
          status: 'ACTIVE',
          vertical,
          onboardingCompletedAt: new Date(),
        },
      });
      const envelope = (value: string) => `fixture:${id}:${Buffer.from(value).toString('base64')}`;
      const client = await db.client.create({
        data: {
          psychologistId: id,
          isDemo: false,
          fullNameEncrypted: envelope('Fictional patient'),
          contactPhoneEncrypted: envelope('+971500000000'),
        },
      });
      const settings = await saveReceptionSettings(id, {
        ...defaultReceptionSettings('Fictional practice'),
        enabled: true,
        slug: id,
        hours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          startMinute: 8 * 60,
          endMinute: 18 * 60,
        })),
        faqs: [{ id: 'hours', question: 'What are your opening hours?', answer: '8 am to 6 pm.' }],
      });
      const desk = await loadPublicReception(settings.slug);
      const slot = desk.slots[0]!;
      expect(slot).toBeDefined();
      const input: ReceptionRequestInput = {
        idempotencyKey: randomUUID(),
        kind: 'BOOKING',
        patientName: 'Fictional requester',
        patientPhone: '+971500000001',
        message: '',
        consentContact: true,
        desiredStartAt: slot.startAt,
      };
      return { practitioner, client, settings, slot, input };
    }

    it.each(['DOCTOR', 'THERAPIST'] as const)(
      'books %s requests once without recording consent or sending messages',
      async (vertical) => {
        const f = await fixture(vertical);
        const receipt = await submitReceptionRequest(f.settings.slug, f.input);
        expect(await submitReceptionRequest(f.settings.slug, f.input)).toEqual(receipt);
        const row = await db.receptionRequest.findUniqueOrThrow({
          where: { id: receipt.requestId },
        });
        expect(row.payloadEncrypted).not.toContain(f.input.patientPhone);
        const action = {
          action: 'APPROVE_BOOKING',
          clientId: f.client.id,
          identityVerified: true,
        } as const;
        const first = await actOnReceptionRequest(f.practitioner.id, receipt.requestId, action);
        expect(await actOnReceptionRequest(f.practitioner.id, receipt.requestId, action)).toEqual(
          first,
        );
        const appointments = await db.appointment.findMany({
          where: { psychologistId: f.practitioner.id },
        });
        expect(appointments).toHaveLength(1);
        expect(appointments[0]?.suppressAutomaticMessages).toBe(true);
        expect(await db.session.count({ where: { psychologistId: f.practitioner.id } })).toBe(1);
        expect(await db.consent.count({ where: { clientId: f.client.id } })).toBe(0);
        expect(await submitReceptionRequest(f.settings.slug, f.input)).toEqual(receipt);
        const publicDesk = await loadPublicReception(f.settings.slug);
        expect(JSON.stringify(publicDesk)).not.toContain('Fictional requester');
        expect(publicDesk.slots.some((slot) => slot.startAt === f.slot.startAt)).toBe(false);
      },
    );

    it.each([
      ['true', 'request', 'single'],
      ['false', 'request', 'single'],
      ['true', 'appointment', 'single'],
      ['false', 'appointment', 'single'],
      ['true', 'request', 'bulk'],
      ['false', 'request', 'bulk'],
      ['true', 'appointment', 'bulk'],
      ['false', 'appointment', 'bulk'],
    ])(
      'rejects paused custody transfer with pilot=%s history=%s scope=%s on real PostgreSQL',
      async (pilot, history, mode) => {
        const source = await fixture();
        const target = await fixture();
        const receipt = await submitReceptionRequest(source.settings.slug, source.input);
        await actOnReceptionRequest(source.practitioner.id, receipt.requestId, {
          action: 'APPROVE_BOOKING',
          clientId: source.client.id,
          identityVerified: true,
        });
        const appointment = await db.appointment.findFirstOrThrow({
          where: { psychologistId: source.practitioner.id },
        });
        await saveReceptionSettings(source.practitioner.id, { ...source.settings, enabled: false });
        await saveReceptionSettings(target.practitioner.id, { ...target.settings, enabled: false });
        if (history === 'appointment') {
          await actOnReceptionRequest(source.practitioner.id, receipt.requestId, {
            action: 'ERASE',
            confirmErase: true,
          });
          // Exercise the session-only link: Appointment has scalar IDs, not
          // Prisma client/session relations, and clientId is legitimately nullable.
          await db.appointment.update({
            where: { id: appointment.id },
            data: { clientId: null },
          });
        }
        vi.stubEnv('RECEPTION_PILOT_ENABLED', pilot);
        try {
          await expect(
            db.$transaction(async (tx) => {
              if (mode === 'single') {
                await transferClientCustody(tx, {
                  clientId: source.client.id,
                  fromPsychologistId: source.practitioner.id,
                  toPsychologistId: target.practitioner.id,
                });
              } else {
                await transferAllCustody(tx, {
                  fromPsychologistId: source.practitioner.id,
                  toPsychologistId: target.practitioner.id,
                });
              }
            }),
          ).rejects.toThrow(
            'Custody transfer is not supported for patients with reception booking history',
          );
          expect(
            await db.client.findUniqueOrThrow({ where: { id: source.client.id } }),
          ).toMatchObject({ psychologistId: source.practitioner.id });
          expect(
            await db.session.findUniqueOrThrow({ where: { id: appointment.sessionId! } }),
          ).toMatchObject({ psychologistId: source.practitioner.id });
          expect(
            await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
          ).toMatchObject({ psychologistId: source.practitioner.id });
        } finally {
          vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
        }
      },
    );

    it('serializes simultaneous approvals for one slot', async () => {
      const f = await fixture();
      const one = await submitReceptionRequest(f.settings.slug, f.input);
      const two = await submitReceptionRequest(f.settings.slug, {
        ...f.input,
        idempotencyKey: randomUUID(),
      });
      const results = await Promise.allSettled(
        [one, two].map(({ requestId }) =>
          actOnReceptionRequest(f.practitioner.id, requestId, {
            action: 'APPROVE_BOOKING',
            clientId: f.client.id,
            identityVerified: true,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.appointment.count({ where: { psychologistId: f.practitioner.id } })).toBe(1);
      expect(
        await db.receptionRequest.count({
          where: { psychologistId: f.practitioner.id, status: 'NEW' },
        }),
      ).toBe(1);
    });

    it('serializes an approval against the legacy calendar write lock', async () => {
      const f = await fixture();
      const receipt = await submitReceptionRequest(f.settings.slug, f.input);
      const results = await Promise.allSettled([
        actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
          action: 'APPROVE_BOOKING',
          clientId: f.client.id,
          identityVerified: true,
        }),
        db.$transaction(async (tx) => {
          await acquireReceptionCalendarLock(tx, f.practitioner.id);
          await assertReceptionCalendarAvailable(tx, f.practitioner.id, {
            from: new Date(f.slot.startAt),
            to: new Date(f.slot.endAt),
            slotMinutes: 30,
          });
          return tx.session.create({
            data: {
              psychologistId: f.practitioner.id,
              clientId: f.client.id,
              scheduledAt: new Date(f.slot.startAt),
              status: 'SCHEDULED',
            },
          });
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.session.count({ where: { psychologistId: f.practitioner.id } })).toBe(1);
    });

    it('rejects cross-owner actions, mismatched replay and erased/demo identities', async () => {
      const f = await fixture();
      const other = await fixture();
      const receipt = await submitReceptionRequest(f.settings.slug, f.input);
      await expect(
        actOnReceptionRequest(other.practitioner.id, receipt.requestId, { action: 'DECLINE' }),
      ).rejects.toThrow('Request not found');
      await expect(
        submitReceptionRequest(f.settings.slug, { ...f.input, patientName: 'Changed requester' }),
      ).rejects.toThrow('already used');
      await expect(
        actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
          action: 'APPROVE_BOOKING',
          clientId: other.client.id,
          identityVerified: true,
        }),
      ).rejects.toThrow();
      await db.client.update({ where: { id: f.client.id }, data: { isDemo: true } });
      await expect(
        actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
          action: 'APPROVE_BOOKING',
          clientId: f.client.id,
          identityVerified: true,
        }),
      ).rejects.toThrow();
      await db.client.update({
        where: { id: f.client.id },
        data: { isDemo: false, deletedAt: new Date() },
      });
      await expect(
        actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
          action: 'APPROVE_BOOKING',
          clientId: f.client.id,
          identityVerified: true,
        }),
      ).rejects.toThrow();
      expect(await db.appointment.count({ where: { psychologistId: f.practitioner.id } })).toBe(0);
    });

    it('deletes enquiries and their activity without deleting the patient or booking', async () => {
      const f = await fixture();
      const receipt = await submitReceptionRequest(f.settings.slug, f.input);
      await actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
        action: 'APPROVE_BOOKING',
        clientId: f.client.id,
        identityVerified: true,
      });
      expect(
        await actOnReceptionRequest(f.practitioner.id, receipt.requestId, {
          action: 'ERASE',
          confirmErase: true,
        }),
      ).toEqual({ erased: true });
      expect(await db.receptionEvent.count({ where: { requestId: receipt.requestId } })).toBe(0);
      expect(await db.client.count({ where: { id: f.client.id } })).toBe(1);
      expect(await db.appointment.count({ where: { psychologistId: f.practitioner.id } })).toBe(1);
      expect(await db.session.count({ where: { psychologistId: f.practitioner.id } })).toBe(1);
    });

    it('rejects stale configuration and stops public access when disabled', async () => {
      const f = await fixture();
      await expect(
        saveReceptionSettings(f.practitioner.id, { ...f.settings, version: 0 }),
      ).rejects.toThrow('changed');
      await saveReceptionSettings(f.practitioner.id, { ...f.settings, enabled: false });
      await expect(loadPublicReception(f.settings.slug)).rejects.toThrow('not available');
      expect((await loadReceptionWorkspace(f.practitioner.id)).settings.enabled).toBe(false);
    });

    it('commits bounded abuse counters under concurrent submissions', async () => {
      const f = await fixture();
      vi.stubEnv('RECEPTION_TRUST_PROXY', 'true');
      const source = `fixture-${randomUUID()}`;
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          consumeReceptionRateLimit(
            f.settings.slug,
            new Request(
              `https://test.invalid/api/v1/public/reception/${f.settings.slug}/requests`,
              { headers: { 'x-forwarded-for': source } },
            ),
          ),
        ),
      );
      vi.stubEnv('RECEPTION_TRUST_PROXY', 'false');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    });
  },
);
