import {
  ClinicalOrderV1Schema,
  MedicationOrderV1Schema,
  type ClinicalOrderDTO,
  type MedicationOrderDTO,
} from '@cureocity/contracts';
import type { ClinicalOrder, MedicationOrder } from '@prisma/client';

/**
 * Sprint DV5 — Prisma order row → DTO. Defensive (per CLAUDE.md §Mappers):
 * invalid stored JSON falls back to a minimal valid shape rather than
 * throwing, so the orders panel keeps rendering even if one row is bad.
 */
export function toMedicationOrderDTO(row: MedicationOrder): MedicationOrderDTO {
  const parsed = MedicationOrderV1Schema.safeParse(row.content);
  const content = parsed.success
    ? parsed.data
    : { version: 'V1' as const, drug: '(unreadable order)', prn: false, interactionWarnings: [] };
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    content,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

export function toClinicalOrderDTO(row: ClinicalOrder): ClinicalOrderDTO {
  const parsed = ClinicalOrderV1Schema.safeParse(row.content);
  const content = parsed.success
    ? parsed.data
    : { version: 'V1' as const, category: 'LAB' as const, description: '(unreadable order)' };
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    content,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}
