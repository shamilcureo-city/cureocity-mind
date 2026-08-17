import type { SessionStatus } from '@cureocity/contracts';
import { transitionEncounter, type EncounterTransition } from './encounter-lifecycle';

export interface StoredEncounter {
  id: string;
  patientId: string;
  practitionerId: string;
  status: SessionStatus;
  consentRecorded: boolean;
  scheduledAt: Date;
}

export type EncounterAuditAction =
  | 'ENCOUNTER_STARTED'
  | 'ENCOUNTER_COMPLETED'
  | 'ENCOUNTER_NO_SHOW';

export interface EncounterAuditEvent {
  action: EncounterAuditAction;
  practitionerId: string;
  encounterId: string;
  patientId: string;
  metadata: Record<string, unknown>;
}

export interface EncounterUnitOfWork<TEncounter extends StoredEncounter> {
  findOwned(encounterId: string, practitionerId: string): Promise<TEncounter | null>;
  transition(
    encounter: TEncounter,
    nextStatus: SessionStatus,
    occurredAt: Date,
  ): Promise<TEncounter>;
  ensureDocumentDraft(encounterId: string): Promise<void>;
  writeAudit(event: EncounterAuditEvent): Promise<void>;
}

export interface TransactionRunner<TEncounter extends StoredEncounter> {
  run<TResult>(work: (unit: EncounterUnitOfWork<TEncounter>) => Promise<TResult>): Promise<TResult>;
}

export interface EncounterCommand {
  encounterId: string;
  practitionerId: string;
  auditMetadata: Record<string, unknown>;
}

export interface MarkEncounterNoShowCommand extends EncounterCommand {
  note?: string;
}

export class EncounterApplicationService<TEncounter extends StoredEncounter> {
  constructor(
    private readonly transactions: TransactionRunner<TEncounter>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(command: EncounterCommand): Promise<TEncounter> {
    return this.execute(command, 'START', 'ENCOUNTER_STARTED', true, false);
  }

  complete(command: EncounterCommand): Promise<TEncounter> {
    return this.execute(command, 'COMPLETE', 'ENCOUNTER_COMPLETED', false, true);
  }

  noShow(command: MarkEncounterNoShowCommand): Promise<TEncounter> {
    return this.execute(
      {
        ...command,
        auditMetadata: {
          ...command.auditMetadata,
          ...(command.note ? { note: command.note } : {}),
        },
      },
      'MARK_NO_SHOW',
      'ENCOUNTER_NO_SHOW',
      false,
      false,
    );
  }

  private execute(
    command: EncounterCommand,
    transition: EncounterTransition,
    auditAction: EncounterAuditAction,
    requiresConsent: boolean,
    ensureDraft: boolean,
  ): Promise<TEncounter> {
    return this.transactions.run<TEncounter>(async (unit) => {
      const encounter = await unit.findOwned(command.encounterId, command.practitionerId);
      if (!encounter) throw new EncounterApplicationError('ENCOUNTER_NOT_FOUND');
      if (requiresConsent && !encounter.consentRecorded) {
        throw new EncounterApplicationError('ENCOUNTER_CONSENT_REQUIRED');
      }

      let nextStatus: SessionStatus;
      try {
        nextStatus = transitionEncounter(encounter.status, transition);
      } catch {
        throw new EncounterApplicationError('INVALID_ENCOUNTER_TRANSITION', {
          currentStatus: encounter.status,
          transition,
        });
      }

      const occurredAt = this.now();
      const previousStatus = encounter.status;
      const updated = await unit.transition(encounter, nextStatus, occurredAt);
      if (ensureDraft) await unit.ensureDocumentDraft(encounter.id);
      await unit.writeAudit({
        action: auditAction,
        practitionerId: command.practitionerId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        metadata: {
          ...command.auditMetadata,
          fromStatus: previousStatus,
          toStatus: nextStatus,
        },
      });
      return updated;
    });
  }
}

export type EncounterApplicationErrorCode =
  | 'ENCOUNTER_NOT_FOUND'
  | 'ENCOUNTER_CONSENT_REQUIRED'
  | 'INVALID_ENCOUNTER_TRANSITION'
  | 'ENCOUNTER_CONCURRENT_MODIFICATION';

export class EncounterApplicationError extends Error {
  constructor(
    readonly code: EncounterApplicationErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'EncounterApplicationError';
  }
}
