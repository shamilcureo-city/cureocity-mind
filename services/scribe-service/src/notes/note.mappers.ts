import type { NoteDraft as NoteDraftRow } from '@prisma/client';
import type { AffectFeature, NoteDraft, SpeakerSegment, TherapyNoteV1 } from '@cureocity/contracts';

export function toNoteDraft(row: NoteDraftRow): NoteDraft {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    transcript: row.transcript,
    speakerSegments:
      row.speakerSegments === null ? null : (row.speakerSegments as unknown as SpeakerSegment[]),
    affectFeatures:
      row.affectFeatures === null ? null : (row.affectFeatures as unknown as AffectFeature[]),
    content: row.content === null ? null : (row.content as unknown as TherapyNoteV1),
    riskSeverity: row.riskSeverity,
    totalCostInr: row.totalCostInr.toString(),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
