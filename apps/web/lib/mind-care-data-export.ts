import type { Prisma } from '@prisma/client';
import {
  MindManualNoteFieldsSchema,
  MindInstrumentDraftStateSchema,
  MindCareRecordBodySchema,
  MindSessionPreparationSchema,
  type DsrDataExport,
  type PractitionerCapability,
} from '@cureocity/contracts';
import { decryptForTenant } from './tenant-crypto';
import { lockActiveClient } from './phi-write-lock';
import { hasMindSessionPreparationStorage } from './mind-session-preparation-storage';

type MindExport = Pick<
  DsrDataExport,
  | 'mindManualNoteDrafts'
  | 'mindInstrumentDrafts'
  | 'mindCareRecords'
  | 'mindSessionPreparations'
  | 'assignmentProvenance'
  | 'omittedMindSections'
>;

async function clinicalJson(psychologistId: string, ciphertext: string): Promise<unknown> {
  const plaintext = await decryptForTenant(psychologistId, ciphertext);
  if (plaintext === null) throw new Error('Clinical export data unavailable');
  return JSON.parse(plaintext);
}

/** Same active-client lock as erasure; no encrypted receipts leave the service. */
export async function loadMindCareDataExport(
  tx: Prisma.TransactionClient,
  clientId: string,
  psychologistId: string,
  capabilities: ReadonlySet<PractitionerCapability>,
): Promise<MindExport> {
  await lockActiveClient(tx, clientId, psychologistId);
  const result: MindExport = { omittedMindSections: [] };
  const where = { clientId, psychologistId };
  if (capabilities.has('BEHAVIORAL_HEALTH_DOCUMENTATION')) {
    const drafts = await tx.mindManualNoteDraft.findMany({
      where: { session: where },
      include: {
        session: { select: { mindPurpose: true } },
      },
      orderBy: { sessionId: 'asc' },
    });
    result.mindManualNoteDrafts = await Promise.all(
      drafts.map(async (row) => ({
        sessionId: row.sessionId,
        mindPurpose: row.session.mindPurpose,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        fields: row.encryptedFields
          ? MindManualNoteFieldsSchema.parse(
              await clinicalJson(psychologistId, row.encryptedFields),
            )
          : null,
      })),
    );
    // Include every revision and explicit clear even while editing is disabled.
    // Before the additive migration, confirmed absence is an empty history.
    result.mindSessionPreparations = [];
    if (await hasMindSessionPreparationStorage(tx)) {
      const preparations = await tx.mindSessionPreparation.findMany({
        where: { psychologistId, session: where },
        orderBy: [{ sessionId: 'asc' }, { revision: 'asc' }],
      });
      result.mindSessionPreparations = await Promise.all(
        preparations.map(async (row) =>
          MindSessionPreparationSchema.omit({ operationId: true }).parse({
            id: row.id,
            sessionId: row.sessionId,
            psychologistId: row.psychologistId,
            revision: row.revision,
            createdAt: row.createdAt.toISOString(),
            body: await clinicalJson(psychologistId, row.bodyEncrypted),
          }),
        ),
      );
    }
    if (capabilities.has('THERAPY_WORKFLOWS')) {
      const records = await tx.clientMindCareRecord.findMany({
        where,
        orderBy: { version: 'asc' },
      });
      result.mindCareRecords = await Promise.all(
        records.map(async (row) => ({
          id: row.id,
          clientId,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          body: MindCareRecordBodySchema.parse(
            await clinicalJson(psychologistId, row.bodyEncrypted),
          ),
        })),
      );
    } else result.omittedMindSections!.push('mindCareRecords');
  } else
    result.omittedMindSections!.push(
      'mindManualNoteDrafts',
      'mindCareRecords',
      'mindSessionPreparations',
    );
  if (
    capabilities.has('MEASUREMENT_BASED_CARE') &&
    capabilities.has('BEHAVIORAL_HEALTH_DOCUMENTATION')
  ) {
    const drafts = await tx.mindInstrumentDraft.findMany({
      where,
      orderBy: { instrumentKey: 'asc' },
    });
    result.mindInstrumentDrafts = await Promise.all(
      drafts.map(async (row) =>
        MindInstrumentDraftStateSchema.parse({
          instrumentKey: row.instrumentKey,
          language: 'en',
          revision: row.revision,
          status: row.status,
          responses:
            row.status === 'ACTIVE' && row.answersEncrypted
              ? await clinicalJson(psychologistId, row.answersEncrypted)
              : {},
          updatedAt: row.updatedAt.toISOString(),
          submittedResponseId: row.submittedResponseId,
          riskFlagged: row.riskFlagged,
        }),
      ),
    );
  } else result.omittedMindSections!.push('mindInstrumentDrafts');
  if (capabilities.has('THERAPY_WORKFLOWS')) {
    result.assignmentProvenance = await tx.exerciseAssignment.findMany({
      where,
      select: { id: true, sourceAgreementId: true, sourceAgreementRevision: true },
      orderBy: { id: 'asc' },
    });
  } else result.omittedMindSections!.push('assignmentProvenance');
  return result;
}
