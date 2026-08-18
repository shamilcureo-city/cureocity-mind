import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260920000000_appointment_reminder_recipient_delivery/migration.sql',
  ),
  'utf8',
);
const outboxMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260916000000_appointment_reminder_outbox/migration.sql',
  ),
  'utf8',
);
const scheduleMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260917000000_appointment_reminder_schedule_version/migration.sql',
  ),
  'utf8',
);
const outboxSource = readFileSync(
  resolve(process.cwd(), 'lib/appointment-reminder-outbox.ts'),
  'utf8',
);

describe('recipient reminder delivery migration', () => {
  it('adds per-recipient identity without breaking the previous deployed writer', () => {
    expect(migration).toContain('CREATE TYPE "AppointmentReminderRecipient"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "recipient"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "submissionStartedAt"');
    expect(migration).toContain(
      'appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_recipient_key',
    );
    expect(migration).toContain('("appointmentId", "scheduledStartAt", "kind", "recipient")');
    expect(migration).toContain('ALTER COLUMN "recipient" SET DEFAULT \'PRACTITIONER_EMAIL\'');
    expect(migration).toContain('ALTER COLUMN "providerIdempotencyKey" DROP NOT NULL');
    expect(migration).not.toContain('DROP COLUMN IF EXISTS "providerIdempotencyKey"');
  });

  it('conservatively backfills legacy rows without risking duplicate retries', () => {
    expect(migration).toContain("WHEN \"status\" IN ('IN_FLIGHT', 'FAILED') THEN 'UNKNOWN'");
    expect(migration).toContain(
      'AND EXISTS (SELECT 1 FROM "appointment_reminder_deliveries" WHERE "recipient" IS NULL)',
    );
    expect(migration).toContain('SET "recipient" = \'PRACTITIONER_EMAIL\'');
    expect(migration).toContain('\'PATIENT_EMAIL\'::"AppointmentReminderRecipient"');
    expect(migration).toContain('appointment."patientEmailEncrypted" IS NOT NULL');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
  });

  it('keeps delivered history and creates no raw recipient address column', () => {
    expect(migration).toContain("WHEN \"status\" = 'DELIVERED' THEN 'DELIVERED'");
    expect(migration).not.toMatch(/ADD COLUMN[^\n]*(?:email|address)/i);
  });

  it('establishes recipient uniqueness before dropping legacy uniqueness and copies patients after', () => {
    const recipientUnique = migration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_recipient_key"',
    );
    const legacyLogicalDrop = migration.indexOf(
      'DROP INDEX IF EXISTS "appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_key"',
    );
    const patientCopy = migration.indexOf('\'PATIENT_EMAIL\'::"AppointmentReminderRecipient"');
    const providerKeyDrop = migration.indexOf(
      'DROP INDEX IF EXISTS "appointment_reminder_deliveries_providerIdempotencyKey_key"',
    );

    expect(recipientUnique).toBeGreaterThan(-1);
    expect(legacyLogicalDrop).toBeGreaterThan(recipientUnique);
    expect(patientCopy).toBeGreaterThan(legacyLogicalDrop);
    expect(providerKeyDrop).toBeGreaterThan(patientCopy);
  });

  it('uses the actual unmapped Appointment table in every SQL path', () => {
    for (const source of [outboxMigration, scheduleMigration, migration, outboxSource]) {
      expect(source).toContain('"Appointment"');
      expect(source).not.toContain('"appointments"');
    }
  });
});
