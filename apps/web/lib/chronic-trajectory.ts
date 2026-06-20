import {
  type ChronicMeasureKey,
  type ChronicMeasureTrajectory,
  type ChronicReadingPoint,
  type ChronicTrajectory,
} from '@cureocity/contracts';
import {
  CHRONIC_MEASURES,
  classifyControl,
  computeChronicTrend,
  formatReading,
} from '@cureocity/clinical';
import type { ClinicalReading } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Sprint DV7 — the per-patient chronic-disease arc composer (the doctor
 * analogue of `journey.ts`). Loads the chronic-reading series, then asks
 * the deterministic engine in `@cureocity/clinical` for the control +
 * trend verdict per measure. No new tables, no LLM. See
 * docs/DOCTOR_VERTICAL.md §9.
 */
const MEASURE_ORDER: ChronicMeasureKey[] = ['BP', 'HBA1C', 'FBS', 'LDL', 'WEIGHT'];

export async function buildChronicTrajectory(
  clientId: string,
  psychologistId: string,
): Promise<ChronicTrajectory> {
  const rows = await prisma.clinicalReading.findMany({
    where: { clientId, psychologistId },
    orderBy: { takenAt: 'asc' },
  });

  const byMeasure = new Map<ChronicMeasureKey, ClinicalReading[]>();
  for (const r of rows) {
    const key = r.measure as ChronicMeasureKey;
    const list = byMeasure.get(key);
    if (list) list.push(r);
    else byMeasure.set(key, [r]);
  }

  const measures: ChronicMeasureTrajectory[] = [];
  for (const key of MEASURE_ORDER) {
    const series = byMeasure.get(key);
    if (!series || series.length === 0) continue;
    const def = CHRONIC_MEASURES[key];

    const points: ChronicReadingPoint[] = series.map((r) => ({
      value: r.value,
      valueSecondary: r.valueSecondary ?? null,
      takenAt: r.takenAt.toISOString(),
      display: formatReading(key, r.value, r.valueSecondary ?? undefined),
    }));
    const baseline = points[0]!;
    const latest = points[points.length - 1]!;

    // BP needs a diastolic to classify; skip control if a manual row
    // somehow lacks it (the route enforces it, but stay defensive).
    const control =
      key === 'BP' && latest.valueSecondary === null
        ? null
        : classifyControl(key, latest.value, latest.valueSecondary ?? undefined);
    const trend = computeChronicTrend(key, baseline.value, latest.value);

    const summary =
      points.length >= 2
        ? `${baseline.display} → ${latest.display} ${def.unit} over ${points.length} readings`
        : `${latest.display} ${def.unit}`;

    measures.push({
      measure: key,
      label: def.label,
      unit: def.unit,
      targetText: def.targetText,
      series: points,
      baseline,
      latest,
      control,
      trend,
      summary,
    });
  }

  return { measures };
}
