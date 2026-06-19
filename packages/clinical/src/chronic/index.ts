/**
 * Sprint DV7 — chronic-disease control engine (the moat).
 *
 * The doctor-vertical analogue of the PHQ-9/GAD-7 reliable-change engine
 * (`change-score.ts`): turn a series of BP / HbA1c / FBS / LDL / weight
 * readings into a deterministic CONTROL verdict + TREND, with NO LLM. The
 * thresholds below are guideline-anchored and CITATION-GATED — do not
 * loosen a target or a meaningful-change threshold without a clinician
 * sign-off + a citation, exactly like the symptom-instrument thresholds.
 *
 * Targets (general adult; individualise at the bedside):
 *   - BP < 140/90 mmHg — ICMR India Hypertension guideline; JNC-8 general.
 *   - HbA1c < 7.0 %     — ADA Standards of Care (general non-pregnant).
 *   - FBS 80–130 mg/dL  — ADA preprandial glucose target.
 *   - LDL < 100 mg/dL   — general; < 70 for established ASCVD (not encoded).
 *   - Weight            — no universal target; tracked as a trend only.
 *
 * Meaningful change (for the trend verdict):
 *   - BP systolic ≥ 5 mmHg   — SPRINT / hypertension-trial convention.
 *   - HbA1c ≥ 0.5 %          — commonly cited diabetes MCID (ADA).
 *   - FBS ≥ 15 mg/dL, LDL ≥ 10 mg/dL — conservative clinical deltas.
 *
 * Lower is better for BP / HbA1c / FBS / LDL, so a NEGATIVE delta
 * (latest < baseline) is improvement.
 */

export type ChronicMeasureKey = 'BP' | 'HBA1C' | 'FBS' | 'LDL' | 'WEIGHT';
export type ControlStatus = 'controlled' | 'borderline' | 'uncontrolled';
export type ChronicTrend = 'improving' | 'stable' | 'worsening';

export interface ChronicMeasureDef {
  key: ChronicMeasureKey;
  label: string;
  unit: string;
  /** BP carries a secondary (diastolic) value. */
  composite: boolean;
  /** Lower readings are clinically better. */
  lowerIsBetter: boolean;
  /** Whether the measure has an encoded control target (weight does not). */
  hasControlTarget: boolean;
  /** Human-readable target, for the UI + the patient report. */
  targetText: string;
  /** Primary-value change that exceeds noise — drives the trend verdict. */
  meaningfulChange: number;
}

export const CHRONIC_MEASURES: Record<ChronicMeasureKey, ChronicMeasureDef> = {
  BP: {
    key: 'BP',
    label: 'Blood pressure',
    unit: 'mmHg',
    composite: true,
    lowerIsBetter: true,
    hasControlTarget: true,
    targetText: '< 140/90 mmHg',
    meaningfulChange: 5,
  },
  HBA1C: {
    key: 'HBA1C',
    label: 'HbA1c',
    unit: '%',
    composite: false,
    lowerIsBetter: true,
    hasControlTarget: true,
    targetText: '< 7.0 %',
    meaningfulChange: 0.5,
  },
  FBS: {
    key: 'FBS',
    label: 'Fasting blood sugar',
    unit: 'mg/dL',
    composite: false,
    lowerIsBetter: true,
    hasControlTarget: true,
    targetText: '80–130 mg/dL',
    meaningfulChange: 15,
  },
  LDL: {
    key: 'LDL',
    label: 'LDL cholesterol',
    unit: 'mg/dL',
    composite: false,
    lowerIsBetter: true,
    hasControlTarget: true,
    targetText: '< 100 mg/dL',
    meaningfulChange: 10,
  },
  WEIGHT: {
    key: 'WEIGHT',
    label: 'Weight',
    unit: 'kg',
    composite: false,
    lowerIsBetter: true,
    hasControlTarget: false,
    targetText: '—',
    meaningfulChange: 2,
  },
};

export class ChronicMeasureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChronicMeasureError';
  }
}

/**
 * Classify a single reading's control status. `secondary` is required for
 * BP (diastolic). Returns null for measures without an encoded target
 * (weight).
 */
export function classifyControl(
  key: ChronicMeasureKey,
  value: number,
  secondary?: number,
): ControlStatus | null {
  if (!Number.isFinite(value)) throw new ChronicMeasureError('Reading value must be finite');
  switch (key) {
    case 'BP': {
      const sys = value;
      const dia = secondary ?? NaN;
      if (!Number.isFinite(dia)) {
        throw new ChronicMeasureError('BP requires a diastolic (secondary) value');
      }
      if (sys >= 160 || dia >= 100) return 'uncontrolled';
      if (sys < 140 && dia < 90) return 'controlled';
      return 'borderline';
    }
    case 'HBA1C':
      if (value > 8) return 'uncontrolled';
      if (value < 7) return 'controlled';
      return 'borderline';
    case 'FBS':
      if (value < 70 || value > 160) return 'uncontrolled';
      if (value >= 80 && value <= 130) return 'controlled';
      return 'borderline';
    case 'LDL':
      if (value > 130) return 'uncontrolled';
      if (value < 100) return 'controlled';
      return 'borderline';
    case 'WEIGHT':
      return null;
  }
}

/**
 * Trend verdict between a baseline and a latest reading of the same
 * measure (primary value — systolic for BP). Returns null for measures
 * without a clinical direction (weight is reported as a raw delta).
 */
export function computeChronicTrend(
  key: ChronicMeasureKey,
  baselineValue: number,
  latestValue: number,
): ChronicTrend | null {
  const def = CHRONIC_MEASURES[key];
  if (!def.hasControlTarget) return null;
  if (!Number.isFinite(baselineValue) || !Number.isFinite(latestValue)) {
    throw new ChronicMeasureError('Trend values must be finite');
  }
  const delta = latestValue - baselineValue;
  if (Math.abs(delta) < def.meaningfulChange) return 'stable';
  const movedDown = delta < 0;
  return movedDown === def.lowerIsBetter ? 'improving' : 'worsening';
}

/** Format a reading for display ("150/90" for BP, "7.2" otherwise). */
export function formatReading(key: ChronicMeasureKey, value: number, secondary?: number): string {
  if (key === 'BP') return `${Math.round(value)}/${Math.round(secondary ?? 0)}`;
  // Keep one decimal for HbA1c; whole numbers elsewhere.
  return key === 'HBA1C' ? value.toFixed(1) : String(Math.round(value));
}
