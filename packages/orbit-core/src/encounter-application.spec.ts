import { describe, expect, it } from 'vitest';
import {
  EncounterApplicationError,
  EncounterApplicationService,
  type EncounterAuditEvent,
  type EncounterUnitOfWork,
  type StoredEncounter,
  type TransactionRunner,
} from './encounter-application';

interface TestEncounter extends StoredEncounter {
  documentDraft: boolean;
}

function fixture(status: TestEncounter['status'] = 'SCHEDULED'): TestEncounter {
  return {
    id: 'encounter-1',
    patientId: 'patient-1',
    practitionerId: 'practitioner-1',
    status,
    consentRecorded: true,
    scheduledAt: new Date('2026-08-15T10:00:00.000Z'),
    documentDraft: false,
  };
}

class MemoryTransactionRunner implements TransactionRunner<TestEncounter> {
  audits: EncounterAuditEvent[] = [];
  failAudit = false;
  constructor(public encounter: TestEncounter) {}

  async run<TResult>(work: (unit: EncounterUnitOfWork<TestEncounter>) => Promise<TResult>) {
    const pending = structuredClone(this.encounter);
    const audits: EncounterAuditEvent[] = [];
    const unit: EncounterUnitOfWork<TestEncounter> = {
      findOwned: async (id, practitionerId) =>
        pending.id === id && pending.practitionerId === practitionerId ? pending : null,
      transition: async (encounter, status) => {
        encounter.status = status;
        return encounter;
      },
      ensureDocumentDraft: async () => {
        pending.documentDraft = true;
      },
      writeAudit: async (event) => {
        if (this.failAudit) throw new Error('audit unavailable');
        audits.push(event);
      },
    };
    const result = await work(unit);
    this.encounter = pending;
    this.audits.push(...audits);
    return result;
  }
}

const command = {
  encounterId: 'encounter-1',
  practitionerId: 'practitioner-1',
  auditMetadata: { requestId: 'request-1' },
};

describe('EncounterApplicationService', () => {
  it('starts an owned, consented encounter and audits in one transaction', async () => {
    const runner = new MemoryTransactionRunner(fixture());
    const service = new EncounterApplicationService(runner, () => new Date('2026-08-15T10:05:00Z'));
    await expect(service.start(command)).resolves.toMatchObject({ status: 'IN_PROGRESS' });
    expect(runner.audits).toMatchObject([
      {
        action: 'ENCOUNTER_STARTED',
        patientId: 'patient-1',
        metadata: { fromStatus: 'SCHEDULED', toStatus: 'IN_PROGRESS' },
      },
    ]);
  });

  it('completes the encounter and creates its document draft atomically', async () => {
    const runner = new MemoryTransactionRunner(fixture('IN_PROGRESS'));
    await new EncounterApplicationService(runner).complete(command);
    expect(runner.encounter).toMatchObject({ status: 'COMPLETED', documentDraft: true });
    expect(runner.audits[0]?.action).toBe('ENCOUNTER_COMPLETED');
  });

  it('rolls back the transition and draft when audit persistence fails', async () => {
    const runner = new MemoryTransactionRunner(fixture('IN_PROGRESS'));
    runner.failAudit = true;
    await expect(new EncounterApplicationService(runner).complete(command)).rejects.toThrow(
      'audit unavailable',
    );
    expect(runner.encounter).toMatchObject({ status: 'IN_PROGRESS', documentDraft: false });
  });

  it('rejects missing consent, invalid state, and cross-tenant access with stable codes', async () => {
    const noConsent = fixture();
    noConsent.consentRecorded = false;
    await expect(
      new EncounterApplicationService(new MemoryTransactionRunner(noConsent)).start(command),
    ).rejects.toMatchObject({
      code: 'ENCOUNTER_CONSENT_REQUIRED',
    } satisfies Partial<EncounterApplicationError>);
    await expect(
      new EncounterApplicationService(new MemoryTransactionRunner(fixture('COMPLETED'))).complete(
        command,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ENCOUNTER_TRANSITION',
    } satisfies Partial<EncounterApplicationError>);
    await expect(
      new EncounterApplicationService(new MemoryTransactionRunner(fixture())).start({
        ...command,
        practitionerId: 'other-practitioner',
      }),
    ).rejects.toMatchObject({
      code: 'ENCOUNTER_NOT_FOUND',
    } satisfies Partial<EncounterApplicationError>);
  });
});
