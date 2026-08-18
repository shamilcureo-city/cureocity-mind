import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260917000000_appointment_reminder_schedule_version/migration.sql',
  ),
  'utf8',
);

describe('appointment reminder schedule-version migration', () => {
  it('preserves delivered history without letting old unknown schedules block current reminders', () => {
    expect(migration).toContain(
      `DELETE FROM "appointment_reminder_deliveries"\nWHERE "status" <> 'DELIVERED';`,
    );
    expect(migration).toContain('appointment."reminded24At" = delivery."deliveredAt"');
    expect(migration).toContain('appointment."reminded2At" = delivery."deliveredAt"');
    expect(migration).toContain('ELSE delivery."createdAt"');
  });

  it('replaces the old unique generation with scheduled-start uniqueness', () => {
    expect(migration).toContain(
      'appointment_reminder_deliveries_appointmentId_scheduledStartAt_kind_key',
    );
    expect(migration).toContain('("appointmentId", "scheduledStartAt", "kind")');
  });
});
