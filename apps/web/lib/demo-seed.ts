import { Prisma, type PrismaClient } from '@prisma/client';

import {
  buildDemoLoadPlan,
  buildDemoLoadPractitioners,
  DEMO_LOAD_DOCTOR_DAILY_MAX,
  DEMO_LOAD_DOCTOR_DAILY_MIN,
  DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
  DEMO_LOAD_PRACTITIONER_UID_PREFIX,
  DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL,
  DEMO_LOAD_UAE_DOCTOR_COUNT,
  type DemoLoadPractitioner,
  type DemoLoadPlan,
} from './demo-load-plan';

/**
 * Persists the fixed September 2026 synthetic workload used by the operator
 * activity calendar. This is load/demo data, never clinical evidence:
 *
 * - 112 clearly synthetic UAE doctors with TEST-DHA registrations.
 * - 89 clearly synthetic Indian psychologists with pending TEST-RCI ids.
 * - 500–800 UAE doctor encounters per day and exactly 250 psychologist
 *   encounters per day from 1–30 September 2026.
 * - Each practitioner has one reusable isDemo=true client; no names, contact
 *   details, audio, transcript, notes, diagnosis, consent, billing, or signed
 *   records are created.
 *
 * The CLI is intentionally explicit (`--apply`). Applying a plan replaces the
 * reserved legacy `seed-*` and current `demo-load-*` namespaces so reruns
 * converge on the same fixed dataset instead of leaving stale dated rows.
 */

const INSERT_BATCH_SIZE = 750;
const LEGACY_UID_PREFIX = 'seed-';

export interface DemoSeedDaySummary {
  date: string;
  status: 'COMPLETED' | 'SCHEDULED';
  doctorEncounters: number;
  psychologistEncounters: number;
}

export interface DemoSeedSummary {
  purged: number;
  practitioners: number;
  therapist: number;
  doctor: number;
  clients: number;
  sessions: number;
  sessionsLast7d: number;
  period: { from: string; through: string };
  daily: DemoSeedDaySummary[];
  uae: {
    practitioners: number;
    sessions: number;
    minDaily: number;
    maxDaily: number;
  };
  indiaPsychologists: {
    practitioners: number;
    sessions: number;
    daily: number;
  };
}

export interface DemoProfileRefreshSummary {
  practitioners: number;
  doctor: number;
  therapist: number;
  alreadyApplied: boolean;
}

const DEMO_PROFILE_HEADLINE = 'Demo practitioner profile — fictional';
const DEMO_PROFILE_BIO =
  'Generated for product demonstration; not a real clinician or issued credential.';
export const DEMO_PROFILE_REFRESH_RELEASE = '2026-09-30-natural-names-v1';
const DEMO_PROFILE_REFRESH_AUDIT_ID = 'cdemoprofilerefreshv1a001';
const DEMO_PROFILE_REFRESH_TARGET = 'DemoProfileRefreshRelease';

function batches<T>(rows: readonly T[], size = INSERT_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    result.push(rows.slice(offset, offset + size));
  }
  return result;
}

function refreshableProfileFields(practitioner: DemoLoadPractitioner) {
  return {
    fullName: practitioner.fullName,
    rciNumber: practitioner.rciNumber,
    medicalRegNumber: practitioner.medicalRegNumber,
    headline: DEMO_PROFILE_HEADLINE,
    bio: DEMO_PROFILE_BIO,
  };
}

async function findReservedPractitioners(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.psychologist.findMany({
    where: {
      OR: [
        { firebaseUid: { startsWith: LEGACY_UID_PREFIX } },
        { firebaseUid: { startsWith: DEMO_LOAD_PRACTITIONER_UID_PREFIX } },
      ],
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Remove only the product-reserved synthetic namespaces. */
export async function purgeDemo(prisma: PrismaClient): Promise<number> {
  const practitionerIds = await findReservedPractitioners(prisma);
  if (practitionerIds.length === 0) return 0;

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { psychologistId: { in: practitionerIds } } }),
    prisma.client.deleteMany({ where: { psychologistId: { in: practitionerIds } } }),
    prisma.psychologist.deleteMany({ where: { id: { in: practitionerIds } } }),
  ]);
  return practitionerIds.length;
}

/**
 * Refresh display-only fields for the exact generated cohort without replacing
 * practitioner ids or touching clients and sessions. The transaction fails
 * closed unless all 201 expected rows are present and still synthetic.
 */
export async function refreshDemoProfiles(
  prisma: PrismaClient,
  releaseId: string,
): Promise<DemoProfileRefreshSummary> {
  const normalizedReleaseId = releaseId.trim();
  if (normalizedReleaseId !== DEMO_PROFILE_REFRESH_RELEASE) {
    throw new Error(`Demo profile refresh requires release ${DEMO_PROFILE_REFRESH_RELEASE}`);
  }

  const practitioners = buildDemoLoadPractitioners();
  const expectedUids = practitioners.map((practitioner) => practitioner.uid);

  return prisma.$transaction(
    async (tx) => {
      // The fixed primary key is both a concurrency lock and the durable
      // completion receipt. PostgreSQL serializes competing inserts on it;
      // the marker rolls back with the profile updates if any check fails.
      const marker = await tx.auditLog.createMany({
        data: [
          {
            id: DEMO_PROFILE_REFRESH_AUDIT_ID,
            actorType: 'SYSTEM',
            action: 'PSYCHOLOGIST_UPDATED',
            targetType: DEMO_PROFILE_REFRESH_TARGET,
            targetId: DEMO_PROFILE_REFRESH_AUDIT_ID,
            metadata: {
              op: 'demo-profile-refresh',
              source: 'release-maintenance',
              version: normalizedReleaseId,
            },
          },
        ],
        skipDuplicates: true,
      });
      if (marker.count === 0) {
        const completed = await tx.auditLog.findUnique({
          where: { id: DEMO_PROFILE_REFRESH_AUDIT_ID },
          select: {
            actorType: true,
            action: true,
            targetType: true,
            targetId: true,
          },
        });
        if (
          !completed ||
          completed.actorType !== 'SYSTEM' ||
          completed.action !== 'PSYCHOLOGIST_UPDATED' ||
          completed.targetType !== DEMO_PROFILE_REFRESH_TARGET ||
          completed.targetId !== DEMO_PROFILE_REFRESH_AUDIT_ID
        ) {
          throw new Error('Demo profile refresh audit marker collision');
        }
        return {
          practitioners: practitioners.length,
          doctor: DEMO_LOAD_UAE_DOCTOR_COUNT,
          therapist: DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
          alreadyApplied: true,
        };
      }
      if (marker.count !== 1) {
        throw new Error(`Demo profile refresh created ${marker.count} release markers`);
      }

      const existing = await tx.psychologist.findMany({
        where: {
          firebaseUid: { in: expectedUids },
          isSynthetic: true,
          deletedAt: null,
        },
        select: { id: true, firebaseUid: true, vertical: true },
      });
      const doctors = existing.filter((row) => row.vertical === 'DOCTOR').length;
      const therapists = existing.filter((row) => row.vertical === 'THERAPIST').length;
      if (
        existing.length !== practitioners.length ||
        doctors !== DEMO_LOAD_UAE_DOCTOR_COUNT ||
        therapists !== DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT
      ) {
        throw new Error(
          `Demo profile refresh expected ${practitioners.length} isolated practitioners (${DEMO_LOAD_UAE_DOCTOR_COUNT} doctors, ${DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT} therapists); found ${existing.length} (${doctors} doctors, ${therapists} therapists)`,
        );
      }

      const desiredByUid = new Map(practitioners.map((row) => [row.uid, row]));
      const verticalMismatch = existing.find(
        (row) => desiredByUid.get(row.firebaseUid)?.vertical !== row.vertical,
      );
      if (verticalMismatch) {
        throw new Error(
          `Demo profile refresh found a vertical mismatch for ${verticalMismatch.firebaseUid}`,
        );
      }

      const ids = existing.map((row) => row.id);
      const desiredRciNumbers = practitioners.map((row) => row.rciNumber);
      const desiredMedicalNumbers = practitioners
        .map((row) => row.medicalRegNumber)
        .filter((value): value is string => value !== null);
      const collisions = await tx.psychologist.count({
        where: {
          id: { notIn: ids },
          OR: [
            { rciNumber: { in: desiredRciNumbers } },
            { medicalRegNumber: { in: desiredMedicalNumbers } },
          ],
        },
      });
      if (collisions > 0) {
        throw new Error(`Demo profile refresh found ${collisions} credential collision(s)`);
      }

      const byUid = new Map(existing.map((row) => [row.firebaseUid, row]));
      const results = await Promise.all(
        practitioners.map((practitioner) => {
          const row = byUid.get(practitioner.uid);
          if (!row) throw new Error(`Missing isolated demo practitioner ${practitioner.uid}`);
          return tx.psychologist.updateMany({
            where: {
              id: row.id,
              firebaseUid: practitioner.uid,
              isSynthetic: true,
              vertical: practitioner.vertical,
              deletedAt: null,
            },
            data: refreshableProfileFields(practitioner),
          });
        }),
      );
      const updated = results.reduce((sum, result) => sum + result.count, 0);
      if (updated !== practitioners.length) {
        throw new Error(
          `Demo profile refresh updated ${updated}/${practitioners.length} practitioners`,
        );
      }

      return {
        practitioners: updated,
        doctor: doctors,
        therapist: therapists,
        alreadyApplied: false,
      };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

function practitionerRows(plan: DemoLoadPlan): Prisma.PsychologistCreateManyInput[] {
  return plan.practitioners.map((practitioner) => ({
    firebaseUid: practitioner.uid,
    email: practitioner.email,
    phone: practitioner.phone,
    ...refreshableProfileFields(practitioner),
    rciVerifiedAt: null,
    status: 'ACTIVE',
    vertical: practitioner.vertical,
    profession: practitioner.vertical === 'DOCTOR' ? 'PHYSICIAN' : 'PSYCHOLOGIST',
    specialty: practitioner.specialty,
    specialties: practitioner.specialty ? [practitioner.specialty] : [],
    languages: practitioner.languages,
    modalities: practitioner.modalities,
    yearsOfExperience: practitioner.years,
    locationCity: practitioner.city,
    locationProvince: practitioner.province,
    sessionFeeInr: null,
    isAcceptingNewClients: false,
    onboardingCompletedAt: practitioner.createdAt,
    isSynthetic: true,
    createdAt: practitioner.createdAt,
  }));
}

function assertPlanOwnership(plan: DemoLoadPlan): void {
  if (plan.clients.length !== plan.practitioners.length) {
    throw new Error(
      `Synthetic plan must have one demo client per practitioner: ${plan.clients.length}/${plan.practitioners.length}`,
    );
  }

  const clientById = new Map(plan.clients.map((client) => [client.id, client]));
  const clientOwners = new Set(plan.clients.map((client) => client.practitionerUid));
  if (clientById.size !== plan.clients.length || clientOwners.size !== plan.practitioners.length) {
    throw new Error('Synthetic plan contains duplicate client ids or practitioner ownership');
  }

  const ownershipMismatch = plan.sessions.find(
    (session) => clientById.get(session.clientId)?.practitionerUid !== session.practitionerUid,
  );
  if (ownershipMismatch) {
    throw new Error(`Synthetic session ${ownershipMismatch.id} has an invalid client owner`);
  }
}

function summaryFor(plan: DemoLoadPlan, purged: number): DemoSeedSummary {
  const daily: DemoSeedDaySummary[] = plan.days.map((day) => ({
    date: day.dateKey,
    status: day.status,
    doctorEncounters: day.doctorEncounterTotal,
    psychologistEncounters: day.psychologistEncounterTotal,
  }));
  const uaeSessions = daily.reduce((sum, day) => sum + day.doctorEncounters, 0);
  const psychologistSessions = daily.reduce((sum, day) => sum + day.psychologistEncounters, 0);
  const finalSeven = daily
    .slice(-7)
    .reduce((sum, day) => sum + day.doctorEncounters + day.psychologistEncounters, 0);

  return {
    purged,
    practitioners: plan.practitioners.length,
    therapist: DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
    doctor: DEMO_LOAD_UAE_DOCTOR_COUNT,
    clients: plan.clients.length,
    sessions: plan.sessions.length,
    sessionsLast7d: finalSeven,
    period: { from: plan.startDate, through: plan.endDate },
    daily,
    uae: {
      practitioners: DEMO_LOAD_UAE_DOCTOR_COUNT,
      sessions: uaeSessions,
      minDaily: Math.min(...daily.map((day) => day.doctorEncounters)),
      maxDaily: Math.max(...daily.map((day) => day.doctorEncounters)),
    },
    indiaPsychologists: {
      practitioners: DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
      sessions: psychologistSessions,
      daily: DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL,
    },
  };
}

function emptySummary(purged: number): DemoSeedSummary {
  return {
    purged,
    practitioners: 0,
    therapist: 0,
    doctor: 0,
    clients: 0,
    sessions: 0,
    sessionsLast7d: 0,
    period: { from: '2026-09-01', through: '2026-09-30' },
    daily: [],
    uae: { practitioners: 0, sessions: 0, minDaily: 0, maxDaily: 0 },
    indiaPsychologists: { practitioners: 0, sessions: 0, daily: 0 },
  };
}

/**
 * Replace the reserved synthetic cohort. Code deployment alone never calls
 * this function; the dedicated CLI requires `--apply` or `--purge`.
 */
export async function seedDemo(
  prisma: PrismaClient,
  opts: { purge?: boolean } = {},
): Promise<DemoSeedSummary> {
  if (opts.purge) return emptySummary(await purgeDemo(prisma));

  const plan = buildDemoLoadPlan();
  // Validate the complete in-memory plan before deleting the previous cohort.
  // This guards the product's one-demo-client-per-practitioner invariant and
  // prevents an invalid generated plan from turning replacement into a purge.
  assertPlanOwnership(plan);
  const purged = await purgeDemo(prisma);
  await prisma.psychologist.createMany({ data: practitionerRows(plan) });

  const persistedPractitioners = await prisma.psychologist.findMany({
    where: { firebaseUid: { in: plan.practitioners.map((row) => row.uid) } },
    select: { id: true, firebaseUid: true },
  });
  const practitionerIdByUid = new Map(
    persistedPractitioners.map((row) => [row.firebaseUid, row.id]),
  );
  if (practitionerIdByUid.size !== plan.practitioners.length) {
    throw new Error(
      `Synthetic practitioner insert mismatch: expected ${plan.practitioners.length}, found ${practitionerIdByUid.size}`,
    );
  }

  const clientRows: Prisma.ClientCreateManyInput[] = plan.clients.map((client) => {
    const psychologistId = practitionerIdByUid.get(client.practitionerUid);
    if (!psychologistId) throw new Error(`Missing practitioner ${client.practitionerUid}`);
    return {
      id: client.id,
      psychologistId,
      clientFirebaseUid: client.clientFirebaseUid,
      status: client.status,
      preferredLanguage: client.preferredLanguage,
      spokenLanguages: client.spokenLanguages,
      isDemo: true,
    };
  });
  for (const batch of batches(clientRows)) {
    await prisma.client.createMany({ data: batch });
  }

  const sessionRows: Prisma.SessionCreateManyInput[] = plan.sessions.map((session) => {
    const psychologistId = practitionerIdByUid.get(session.practitionerUid);
    if (!psychologistId) throw new Error(`Missing practitioner ${session.practitionerUid}`);
    return {
      id: session.id,
      clientId: session.clientId,
      psychologistId,
      status: session.status,
      kind: session.kind,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt,
      language: session.language,
      spokenLanguages: session.spokenLanguages,
      captureMode: session.captureMode,
      tokenNumber: session.tokenNumber,
      modality: session.modality,
    };
  });
  for (const batch of batches(sessionRows)) {
    await prisma.session.createMany({ data: batch });
  }

  const practitionerIds = [...practitionerIdByUid.values()];
  const [practitioners, clients, sessions] = await Promise.all([
    prisma.psychologist.count({ where: { id: { in: practitionerIds }, isSynthetic: true } }),
    prisma.client.count({ where: { psychologistId: { in: practitionerIds }, isDemo: true } }),
    prisma.session.count({ where: { psychologistId: { in: practitionerIds } } }),
  ]);
  if (
    practitioners !== plan.practitioners.length ||
    clients !== plan.clients.length ||
    sessions !== plan.sessions.length
  ) {
    throw new Error(
      `Synthetic load verification failed: practitioners ${practitioners}/${plan.practitioners.length}, clients ${clients}/${plan.clients.length}, sessions ${sessions}/${plan.sessions.length}`,
    );
  }

  const summary = summaryFor(plan, purged);
  if (
    summary.uae.minDaily < DEMO_LOAD_DOCTOR_DAILY_MIN ||
    summary.uae.maxDaily > DEMO_LOAD_DOCTOR_DAILY_MAX
  ) {
    throw new Error('Synthetic doctor daily totals fell outside the requested 500–800 range');
  }
  return summary;
}
