import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildDemoLoadPlan } from './demo-load-plan';
import { refreshDemoProfiles } from './demo-seed';

interface FakePractitioner {
  id: string;
  firebaseUid: string;
  vertical: 'DOCTOR' | 'THERAPIST';
  isSynthetic: boolean;
  deletedAt: Date | null;
  fullName: string;
  rciNumber: string;
  medicalRegNumber: string | null;
  headline: string | null;
  bio: string | null;
}

function fakeDatabase(
  options: {
    missing?: number;
    collisions?: number;
    zeroUpdateAt?: number;
    swappedVerticals?: boolean;
  } = {},
) {
  const plan = buildDemoLoadPlan();
  const targets: FakePractitioner[] = plan.practitioners
    .slice(0, plan.practitioners.length - (options.missing ?? 0))
    .map((practitioner, index) => ({
      id: `practitioner-${index + 1}`,
      firebaseUid: practitioner.uid,
      vertical: practitioner.vertical,
      isSynthetic: true,
      deletedAt: null,
      fullName: `Old demo practitioner ${index + 1}`,
      rciNumber: `OLD-RCI-${index + 1}`,
      medicalRegNumber: practitioner.vertical === 'DOCTOR' ? `OLD-DHA-${index + 1}` : null,
      headline: null,
      bio: null,
    }));
  if (options.swappedVerticals) {
    const doctor = targets.find((row) => row.vertical === 'DOCTOR');
    const therapist = targets.find((row) => row.vertical === 'THERAPIST');
    if (doctor && therapist) {
      doctor.vertical = 'THERAPIST';
      therapist.vertical = 'DOCTOR';
    }
  }
  const realLookalike: FakePractitioner = {
    id: 'real-lookalike',
    firebaseUid: 'demo-load-uae-doctor-lookalike',
    vertical: 'DOCTOR',
    isSynthetic: false,
    deletedAt: null,
    fullName: 'Real Prefix Lookalike',
    rciNumber: 'REAL-RCI',
    medicalRegNumber: 'REAL-DHA',
    headline: 'Real profile',
    bio: 'Must remain unchanged',
  };
  const rows = [...targets, realLookalike];
  let updateCalls = 0;

  const tx = {
    psychologist: {
      findMany: async ({ where }: { where: { firebaseUid: { in: string[] } } }) => {
        const exactUids = new Set(where.firebaseUid.in);
        return rows
          .filter((row) => row.isSynthetic && exactUids.has(row.firebaseUid))
          .map(({ id, firebaseUid, vertical }) => ({ id, firebaseUid, vertical }));
      },
      count: async () => options.collisions ?? 0,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        updateCalls += 1;
        if (updateCalls === options.zeroUpdateAt) return { count: 0 };
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.firebaseUid === where.firebaseUid &&
            candidate.isSynthetic === true &&
            candidate.vertical === where.vertical &&
            candidate.deletedAt === null,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };

  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => {
      const snapshot = structuredClone(rows);
      try {
        return await operation(tx);
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    },
  } as unknown as PrismaClient;

  return { prisma, rows, getUpdateCalls: () => updateCalls };
}

describe('demo practitioner profile refresh', () => {
  it('updates exactly 201 isolated profiles in place and is idempotent', async () => {
    const fixture = fakeDatabase();
    const beforeIds = fixture.rows.filter((row) => row.isSynthetic).map((row) => row.id);

    await expect(refreshDemoProfiles(fixture.prisma)).resolves.toEqual({
      practitioners: 201,
      doctor: 112,
      therapist: 89,
    });
    await expect(refreshDemoProfiles(fixture.prisma)).resolves.toEqual({
      practitioners: 201,
      doctor: 112,
      therapist: 89,
    });

    const targets = fixture.rows.filter((row) => row.isSynthetic);
    expect(targets.map((row) => row.id)).toEqual(beforeIds);
    expect(new Set(targets.map((row) => row.fullName)).size).toBe(201);
    expect(targets.every((row) => !/synthetic/i.test(row.fullName))).toBe(true);
    expect(
      targets
        .filter((row) => row.vertical === 'DOCTOR')
        .every((row) => /^DHA-DEMO-NOT-ISSUED-\d{4}$/.test(row.medicalRegNumber ?? '')),
    ).toBe(true);
    expect(fixture.rows.find((row) => row.id === 'real-lookalike')).toMatchObject({
      fullName: 'Real Prefix Lookalike',
      medicalRegNumber: 'REAL-DHA',
      headline: 'Real profile',
      bio: 'Must remain unchanged',
    });
    expect(fixture.getUpdateCalls()).toBe(402);
  });

  it('fails before writing when the isolated cohort is incomplete or credentials collide', async () => {
    const incomplete = fakeDatabase({ missing: 1 });
    await expect(refreshDemoProfiles(incomplete.prisma)).rejects.toThrow(
      'expected 201 isolated practitioners',
    );
    expect(incomplete.getUpdateCalls()).toBe(0);

    const collision = fakeDatabase({ collisions: 1 });
    await expect(refreshDemoProfiles(collision.prisma)).rejects.toThrow('credential collision');
    expect(collision.getUpdateCalls()).toBe(0);

    const swapped = fakeDatabase({ swappedVerticals: true });
    await expect(refreshDemoProfiles(swapped.prisma)).rejects.toThrow('vertical mismatch');
    expect(swapped.getUpdateCalls()).toBe(0);
  });

  it('rolls back the profile transaction unless every target updates', async () => {
    const fixture = fakeDatabase({ zeroUpdateAt: 80 });
    const before = structuredClone(fixture.rows);

    await expect(refreshDemoProfiles(fixture.prisma)).rejects.toThrow('updated 200/201');
    expect(fixture.rows).toEqual(before);
  });
});
