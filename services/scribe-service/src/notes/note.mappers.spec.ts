import { Prisma } from '@prisma/client';
import type { NoteDraft as NoteDraftRow } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toNoteDraft } from './note.mappers';

describe('toNoteDraft', () => {
  it('does not expose encrypted transcript storage as plaintext', () => {
    const encryptedTranscript = 'kms:v1:encrypted-transcript';
    const row = {
      id: 'cdraft1111111111111111111',
      sessionId: 'csess11111111111111111111',
      status: 'COMPLETED',
      transcriptEncrypted: encryptedTranscript,
      speakerSegments: null,
      affectFeatures: null,
      content: null,
      riskSeverity: null,
      rxPad: null,
      totalCostInr: new Prisma.Decimal('0'),
      errorMessage: null,
      createdAt: new Date('2026-08-18T10:00:00.000Z'),
      updatedAt: new Date('2026-08-18T10:01:00.000Z'),
    } satisfies NoteDraftRow;

    const mapped = toNoteDraft(row);

    expect(mapped.transcript).toBeNull();
    expect(mapped).not.toHaveProperty('transcriptEncrypted');
    expect(JSON.stringify(mapped)).not.toContain(encryptedTranscript);
  });
});
