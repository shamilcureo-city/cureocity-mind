import { prisma } from './prisma';

/**
 * Server-side data layer for the therapist dashboard. RSCs call these
 * directly; no HTTP round-trip.
 *
 * The dashboard is scoped to one psychologist at a time. For the demo
 * we resolve the seeded dev psychologist by Firebase UID (matching the
 * auth-server bypass). When real auth ships, this swaps to reading the
 * session cookie.
 */

const DEV_BYPASS_FIREBASE_UID = 'dev-firebase-uid-priya';

export async function currentTherapistId(): Promise<string | null> {
  const row = await prisma.psychologist.findUnique({
    where: { firebaseUid: DEV_BYPASS_FIREBASE_UID },
    select: { id: true },
  });
  return row?.id ?? null;
}

export interface DashboardSnapshot {
  therapistName: string;
  counts: {
    activeClients: number;
    pendingBookings: number;
    newIntakes: number;
    upcomingSessions: number;
  };
  pendingBookings: PendingBooking[];
  newIntakes: NewIntake[];
  recentClients: RecentClient[];
}

export interface PendingBooking {
  id: string;
  patientName: string;
  patientEmail: string;
  preferredAt: string;
  message: string | null;
  createdAt: string;
}

export interface NewIntake {
  id: string;
  patientName: string;
  concerns: string[];
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  preferredLanguage: string | null;
  preferredModality: string | null;
  createdAt: string;
}

export interface RecentClient {
  id: string;
  fullName: string;
  status: string;
  presentingConcerns: string | null;
  createdAt: string;
}

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  const therapistId = await currentTherapistId();
  if (!therapistId) return null;

  const therapist = await prisma.psychologist.findUnique({
    where: { id: therapistId },
    select: { fullName: true },
  });
  if (!therapist) return null;

  const [activeClients, pendingBookingRows, newIntakeRows, recentClientRows, upcomingSessions] =
    await Promise.all([
      prisma.client.count({
        where: { psychologistId: therapistId, deletedAt: null, status: 'ACTIVE' },
      }),
      prisma.booking.findMany({
        where: { therapistId, status: 'PENDING' },
        orderBy: { preferredAt: 'asc' },
        take: 10,
      }),
      prisma.intakeSubmission.findMany({
        where: {
          status: 'NEW',
          OR: [{ assignedTherapistId: therapistId }, { assignedTherapistId: null }],
        },
        orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      prisma.client.findMany({
        where: { psychologistId: therapistId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      prisma.session.count({
        where: { psychologistId: therapistId, status: 'SCHEDULED' },
      }),
    ]);

  return {
    therapistName: therapist.fullName,
    counts: {
      activeClients,
      pendingBookings: pendingBookingRows.length,
      newIntakes: newIntakeRows.length,
      upcomingSessions,
    },
    pendingBookings: pendingBookingRows.map((b) => ({
      id: b.id,
      patientName: b.patientName,
      patientEmail: b.patientEmail,
      preferredAt: b.preferredAt.toISOString(),
      message: b.message,
      createdAt: b.createdAt.toISOString(),
    })),
    newIntakes: newIntakeRows.map((i) => ({
      id: i.id,
      patientName: i.patientName,
      concerns: i.concerns,
      urgency: i.urgency,
      preferredLanguage: i.preferredLanguage,
      preferredModality: i.preferredModality,
      createdAt: i.createdAt.toISOString(),
    })),
    recentClients: recentClientRows.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      status: c.status,
      presentingConcerns: c.presentingConcerns,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export async function fetchAllBookings(): Promise<{
  pending: PendingBooking[];
  accepted: PendingBooking[];
  declined: PendingBooking[];
} | null> {
  const therapistId = await currentTherapistId();
  if (!therapistId) return null;
  const rows = await prisma.booking.findMany({
    where: { therapistId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const map = (b: (typeof rows)[number]): PendingBooking => ({
    id: b.id,
    patientName: b.patientName,
    patientEmail: b.patientEmail,
    preferredAt: b.preferredAt.toISOString(),
    message: b.message,
    createdAt: b.createdAt.toISOString(),
  });
  return {
    pending: rows.filter((r) => r.status === 'PENDING').map(map),
    accepted: rows.filter((r) => r.status === 'ACCEPTED').map(map),
    declined: rows.filter((r) => r.status === 'DECLINED').map(map),
  };
}

export async function fetchAllIntakes(): Promise<NewIntake[] | null> {
  const therapistId = await currentTherapistId();
  if (!therapistId) return null;
  const rows = await prisma.intakeSubmission.findMany({
    where: {
      OR: [{ assignedTherapistId: therapistId }, { assignedTherapistId: null }],
    },
    orderBy: [{ status: 'asc' }, { urgency: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return rows.map((i) => ({
    id: i.id,
    patientName: i.patientName,
    concerns: i.concerns,
    urgency: i.urgency,
    preferredLanguage: i.preferredLanguage,
    preferredModality: i.preferredModality,
    createdAt: i.createdAt.toISOString(),
  }));
}

export interface ClientListItem {
  id: string;
  fullName: string;
  status: string;
  presentingConcerns: string | null;
  preferredModality: string | null;
  createdAt: string;
  lastSessionAt: string | null;
}

export async function fetchClients(): Promise<ClientListItem[] | null> {
  const therapistId = await currentTherapistId();
  if (!therapistId) return null;
  const rows = await prisma.client.findMany({
    where: { psychologistId: therapistId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: {
      sessions: { orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
    },
    take: 100,
  });
  return rows.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    status: c.status,
    presentingConcerns: c.presentingConcerns,
    preferredModality: c.preferredModality,
    createdAt: c.createdAt.toISOString(),
    lastSessionAt: c.sessions[0]?.scheduledAt.toISOString() ?? null,
  }));
}

export interface ClientDetail extends ClientListItem {
  contactPhone: string;
  contactEmail: string | null;
  sessions: {
    id: string;
    modality: string;
    status: string;
    scheduledAt: string;
  }[];
}

export async function fetchClientDetail(clientId: string): Promise<ClientDetail | null> {
  const therapistId = await currentTherapistId();
  if (!therapistId) return null;
  const row = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: therapistId, deletedAt: null },
    include: { sessions: { orderBy: { scheduledAt: 'desc' } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.fullName,
    status: row.status,
    presentingConcerns: row.presentingConcerns,
    preferredModality: row.preferredModality,
    createdAt: row.createdAt.toISOString(),
    lastSessionAt: row.sessions[0]?.scheduledAt.toISOString() ?? null,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    sessions: row.sessions.map((s) => ({
      id: s.id,
      modality: s.modality,
      status: s.status,
      scheduledAt: s.scheduledAt.toISOString(),
    })),
  };
}
