import type { Prisma, Session } from '@prisma/client';
import {
  EncounterApplicationError,
  EncounterApplicationService,
  type EncounterAuditAction,
  type EncounterAuditEvent,
  type EncounterUnitOfWork,
  type StoredEncounter,
  type TransactionRunner,
} from '@cureocity/orbit-core';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

interface PrismaEncounter extends StoredEncounter {
  row: Session;
}

const LEGACY_AUDIT_ACTION: Record<
  EncounterAuditAction,
  { action: 'SESSION_STARTED' | 'SESSION_ENDED' | 'SESSION_NO_SHOW' }
> = {
  ENCOUNTER_STARTED: { action: 'SESSION_STARTED' },
  ENCOUNTER_COMPLETED: { action: 'SESSION_ENDED' },
  ENCOUNTER_NO_SHOW: { action: 'SESSION_NO_SHOW' },
};

class PrismaEncounterTransactions implements TransactionRunner<PrismaEncounter> {
  run<TResult>(work: (unit: EncounterUnitOfWork<PrismaEncounter>) => Promise<TResult>) {
    return prisma.$transaction((tx) => work(new PrismaEncounterUnitOfWork(tx)));
  }
}

class PrismaEncounterUnitOfWork implements EncounterUnitOfWork<PrismaEncounter> {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findOwned(encounterId: string, practitionerId: string): Promise<PrismaEncounter | null> {
    const row = await this.tx.session.findFirst({
      where: { id: encounterId, psychologistId: practitionerId },
    });
    return row ? toStoredEncounter(row) : null;
  }

  async transition(
    encounter: PrismaEncounter,
    nextStatus: Session['status'],
    occurredAt: Date,
  ): Promise<PrismaEncounter> {
    const result = await this.tx.session.updateMany({
      where: { id: encounter.id, status: encounter.status },
      data: {
        status: nextStatus,
        ...(nextStatus === 'IN_PROGRESS' && { startedAt: occurredAt }),
        ...(nextStatus === 'COMPLETED' && { endedAt: occurredAt }),
      },
    });
    if (result.count !== 1) {
      throw new EncounterApplicationError('ENCOUNTER_CONCURRENT_MODIFICATION', {
        expectedStatus: encounter.status,
      });
    }
    const row = await this.tx.session.findUniqueOrThrow({ where: { id: encounter.id } });
    return toStoredEncounter(row);
  }

  async ensureDocumentDraft(encounterId: string): Promise<void> {
    await this.tx.noteDraft.upsert({
      where: { sessionId: encounterId },
      create: { sessionId: encounterId, status: 'PENDING' },
      update: {},
    });
  }

  async writeAudit(event: EncounterAuditEvent): Promise<void> {
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: event.practitionerId,
        action: LEGACY_AUDIT_ACTION[event.action].action,
        targetType: 'Session',
        targetId: event.encounterId,
        metadata: { ...event.metadata, clientId: event.patientId },
      },
      this.tx,
    );
  }
}

export const encounterApplicationService = new EncounterApplicationService<PrismaEncounter>(
  new PrismaEncounterTransactions(),
);

export function encounterApplicationErrorResponse(error: EncounterApplicationError): {
  status: number;
  body: {
    error: string;
    code: EncounterApplicationError['code'];
    details: Record<string, unknown>;
  };
} {
  const status =
    error.code === 'ENCOUNTER_NOT_FOUND'
      ? 404
      : error.code === 'INVALID_ENCOUNTER_TRANSITION' ||
          error.code === 'ENCOUNTER_CONCURRENT_MODIFICATION'
        ? 409
        : 400;
  const message = {
    ENCOUNTER_NOT_FOUND: 'Encounter not found',
    ENCOUNTER_CONSENT_REQUIRED: 'Encounter consent must be recorded before starting',
    INVALID_ENCOUNTER_TRANSITION: 'The encounter cannot make that lifecycle transition',
    ENCOUNTER_CONCURRENT_MODIFICATION: 'The encounter changed while this request was processed',
  }[error.code];
  return { status, body: { error: message, code: error.code, details: error.details } };
}

export function unwrapPrismaEncounter(encounter: PrismaEncounter): Session {
  return encounter.row;
}

function toStoredEncounter(row: Session): PrismaEncounter {
  return {
    id: row.id,
    patientId: row.clientId,
    practitionerId: row.psychologistId,
    status: row.status,
    consentRecorded: row.consentSnapshot !== null,
    scheduledAt: row.scheduledAt,
    row,
  };
}
