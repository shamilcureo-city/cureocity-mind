import { Prisma, type PrismaClient } from '@prisma/client';

import {
  buildDemoLoadPlan,
  DEMO_LOAD_DOCTOR_DAILY_MAX,
  DEMO_LOAD_DOCTOR_DAILY_MIN,
  DEMO_LOAD_INDIA_PSYCHOLOGIST_COUNT,
  DEMO_LOAD_PRACTITIONER_UID_PREFIX,
  DEMO_LOAD_PSYCHOLOGIST_DAILY_TOTAL,
  DEMO_LOAD_UAE_DOCTOR_COUNT,
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

function batches<T>(rows: readonly T[], size = INSERT_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    result.push(rows.slice(offset, offset + size));
  }
  return result;
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

function practitionerRows(plan: DemoLoadPlan): Prisma.PsychologistCreateManyInput[] {
  return plan.practitioners.map((practitioner) => ({
    firebaseUid: practitioner.uid,
    email: practitioner.email,
    phone: practitioner.phone,
    fullName: practitioner.fullName,
    rciNumber: practitioner.rciNumber,
    rciVerifiedAt: null,
    status: 'ACTIVE',
    vertical: practitioner.vertical,
    profession: practitioner.vertical === 'DOCTOR' ? 'PHYSICIAN' : 'PSYCHOLOGIST',
    medicalRegNumber: practitioner.medicalRegNumber,
    specialty: practitioner.specialty,
    headline: 'Synthetic test account — not a real practitioner',
    bio: 'Generated only for the September 2026 synthetic activity calendar.',
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
    (session) =>
      clientById.get(session.clientId)?.practitionerUid !== session.practitionerUid,
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
