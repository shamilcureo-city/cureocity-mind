import { MedicalEncounterNoteV1Schema, RxPadV1Schema } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { decryptClientField } from '@/lib/client-pii';
import { listScribeRecords } from '@/lib/scribe-workspace-store';
import { ScribeIntakeBodySchema } from './scribe-intake-contracts';
import {
  ScribeTaskBodySchema,
  type ScribeBriefing,
  type ScribePendingWork,
} from './scribe-preparation-contracts';

export function signedVisitSnapshot(row: {
  content: unknown;
  rxPad: unknown;
  signedAt: Date;
  session: { id: string; scheduledAt: Date };
}): ScribeBriefing['visits'][number] | null {
  if (!row.content || typeof row.content !== 'object' || !('chiefComplaint' in row.content))
    return null;
  const note = MedicalEncounterNoteV1Schema.safeParse(row.content);
  if (!note.success) return null;
  const rx = RxPadV1Schema.safeParse(row.rxPad);
  return {
    sessionId: row.session.id,
    encounterAt: row.session.scheduledAt.toISOString(),
    signedAt: row.signedAt.toISOString(),
    complaint: note.data.chiefComplaint,
    assessment: note.data.assessment,
    plan: note.data.plan,
    prescriptions: rx.success
      ? rx.data.meds
          .filter((med) => med.status === 'confirmed')
          .map((med) => ({
            drug: [med.drug, med.strength].filter(Boolean).join(' '),
            dose: med.dose ?? '',
            frequency: med.frequency ?? '',
            duration: med.durationDays ? `${med.durationDays} days` : '',
          }))
      : [],
  };
}

export async function loadScribeBriefing(
  psychologistId: string,
  clientId: string,
): Promise<ScribeBriefing | null> {
  const patient = await prisma.client.findFirst({
    where: { id: clientId, psychologistId, deletedAt: null },
    select: { allergies: true },
  });
  if (!patient) return null;
  const [rows, intakes] = await Promise.all([
    prisma.therapyNote.findMany({
      where: { locked: true, session: { clientId, psychologistId, client: { deletedAt: null } } },
      orderBy: { signedAt: 'desc' },
      take: 3,
      select: {
        content: true,
        rxPad: true,
        signedAt: true,
        session: { select: { id: true, scheduledAt: true } },
      },
    }),
    listScribeRecords(
      { psychologistId, kind: 'intake', clientId, limit: 500 },
      ScribeIntakeBodySchema,
    ),
  ]);
  const intake = intakes
    .filter(
      (entry) =>
        entry.body.report && entry.body.submittedAt && entry.body.review.status !== 'rejected',
    )
    .sort((a, b) => b.body.submittedAt!.localeCompare(a.body.submittedAt!))[0];
  return {
    allergies: {
      status: patient.allergies.length ? 'recorded' : 'not_recorded',
      entries: patient.allergies,
    },
    intake:
      intake?.body.report && intake.body.submittedAt
        ? {
            submittedAt: intake.body.submittedAt,
            reasonForVisit: intake.body.report.reasonForVisit,
            reviewStatus: intake.body.review.status === 'reviewed' ? 'reviewed' : 'pending',
            authorRole: intake.body.report.authorRole,
            vitals: intake.body.report.vitals,
          }
        : null,
    visits: rows.flatMap((row) => {
      const snapshot = signedVisitSnapshot(row);
      return snapshot ? [snapshot] : [];
    }),
  };
}

export async function loadScribePendingWork(
  psychologistId: string,
  clientId?: string,
): Promise<ScribePendingWork> {
  const [tasks, unsigned] = await Promise.all([
    listScribeRecords(
      { psychologistId, kind: 'task', limit: 500, ...(clientId ? { clientId } : {}) },
      ScribeTaskBodySchema,
    ),
    prisma.session.findMany({
      where: {
        psychologistId,
        ...(clientId ? { clientId } : {}),
        client: { deletedAt: null },
        status: 'COMPLETED',
        noteDraft: { status: 'COMPLETED' },
        OR: [{ therapyNote: null }, { therapyNote: { locked: false } }],
      },
      orderBy: { scheduledAt: 'asc' },
      take: 101,
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
  ]);
  return {
    tasks: tasks.sort((a, b) => a.body.dueDate.localeCompare(b.body.dueDate)),
    unsigned: await Promise.all(
      unsigned.slice(0, 100).map(async (row) => ({
        sessionId: row.id,
        clientId: row.clientId,
        encounterAt: row.scheduledAt.toISOString(),
        patientName: await decryptClientField(psychologistId, row.client.fullNameEncrypted),
      })),
    ),
    unsignedMayHaveMore: unsigned.length > 100,
    tasksMayHaveMore: tasks.length >= 500,
  };
}
