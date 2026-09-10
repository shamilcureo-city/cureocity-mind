import { MindCareRecordBodySchema, type MindCareRecordDto } from '@cureocity/contracts';
import { decryptForTenant } from './tenant-crypto';

export class MindCareRecordUnreadableError extends Error {}

export async function toMindCareRecordDto(row: {
  id: string;
  clientId: string;
  psychologistId: string;
  version: number;
  operationId: string;
  bodyEncrypted: string;
  createdAt: Date;
}): Promise<MindCareRecordDto> {
  const plaintext = await decryptForTenant(row.psychologistId, row.bodyEncrypted);
  try {
    const parsed = MindCareRecordBodySchema.safeParse(
      plaintext === null ? null : JSON.parse(plaintext),
    );
    if (!parsed.success) throw new MindCareRecordUnreadableError();
    return {
      id: row.id,
      clientId: row.clientId,
      version: row.version,
      operationId: row.operationId,
      createdAt: row.createdAt.toISOString(),
      body: parsed.data,
    };
  } catch {
    throw new MindCareRecordUnreadableError('Care record could not be read.');
  }
}
