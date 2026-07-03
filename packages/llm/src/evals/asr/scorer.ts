import type { AsrFixture } from './fixtures';
import { termErrorRate, wordErrorRate } from './wer';

/**
 * Sprint DS8 — score one engine hypothesis against a fixture reference on
 * three axes: overall WER, medical-term WER, and (the safety-critical one)
 * drug-name WER. The aggregate drug-name WER drives the go/no-go gate.
 */
export interface AsrFixtureScore {
  id: string;
  domain: AsrFixture['domain'];
  language: AsrFixture['language'];
  wer: number;
  drugTer: number;
  medicalTer: number;
  drugTotal: number;
  drugMissed: number;
  medicalTotal: number;
  medicalMissed: number;
  /** Drug names the engine dropped/mangled — the report's danger list. */
  drugMisses: string[];
}

export function scoreAsrFixture(fixture: AsrFixture, hypothesis: string): AsrFixtureScore {
  const wer = wordErrorRate(fixture.reference, hypothesis);
  const drug = termErrorRate(fixture.reference, hypothesis, fixture.drugs);
  const medical = termErrorRate(fixture.reference, hypothesis, fixture.medicalTerms);
  return {
    id: fixture.id,
    domain: fixture.domain,
    language: fixture.language,
    wer: wer.wer,
    drugTer: drug.ter,
    medicalTer: medical.ter,
    drugTotal: drug.total,
    drugMissed: drug.missed,
    medicalTotal: medical.total,
    medicalMissed: medical.missed,
    drugMisses: drug.perTerm.filter((t) => t.missed > 0).map((t) => t.term),
  };
}

export interface AsrReport {
  engine: string;
  total: number;
  meanWer: number;
  /** Aggregate = drug occurrences dropped / total drug occurrences. */
  drugNameWer: number;
  medicalWer: number;
  byLanguage: Record<string, { wer: number; drugNameWer: number; n: number }>;
  scores: AsrFixtureScore[];
}

export function aggregateAsr(scores: AsrFixtureScore[], engine: string): AsrReport {
  const total = scores.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const drugTotal = scores.reduce((n, s) => n + s.drugTotal, 0);
  const drugMissed = scores.reduce((n, s) => n + s.drugMissed, 0);
  const medTotal = scores.reduce((n, s) => n + s.medicalTotal, 0);
  const medMissed = scores.reduce((n, s) => n + s.medicalMissed, 0);

  const byLanguage: Record<string, { wer: number; drugNameWer: number; n: number }> = {};
  for (const lang of ['en', 'hi', 'ml']) {
    const rows = scores.filter((s) => s.language === lang);
    if (rows.length === 0) continue;
    const dTot = rows.reduce((n, s) => n + s.drugTotal, 0);
    const dMiss = rows.reduce((n, s) => n + s.drugMissed, 0);
    byLanguage[lang] = {
      wer: mean(rows.map((s) => s.wer)),
      drugNameWer: dTot ? dMiss / dTot : 0,
      n: rows.length,
    };
  }

  return {
    engine,
    total,
    meanWer: mean(scores.map((s) => s.wer)),
    drugNameWer: drugTotal ? drugMissed / drugTotal : 0,
    medicalWer: medTotal ? medMissed / medTotal : 0,
    byLanguage,
    scores,
  };
}

/**
 * The DS8 golden gate. Drug-name WER above the threshold means the engine
 * cannot be trusted to hear drug names, so voice-added prescriptions MUST
 * stay confirm-first (the doctor taps to accept every one). Voice-Rx is
 * confirm-first as shipped (DS5) — this gate exists to BLOCK any future
 * "auto-accept spoken meds" relaxation until the number is safe.
 *
 * From the code-mix ASR literature a 3% drug-name WER is already generous;
 * do not loosen it without a clinician sign-off + a citation.
 */
export const DRUG_NAME_WER_GATE = 0.03;

export interface AsrGate {
  voiceRxConfirmOnly: boolean;
  drugNameWer: number;
  threshold: number;
  verdict: string;
}

export function asrGate(report: AsrReport): AsrGate {
  const over = report.drugNameWer > DRUG_NAME_WER_GATE;
  return {
    voiceRxConfirmOnly: over,
    drugNameWer: report.drugNameWer,
    threshold: DRUG_NAME_WER_GATE,
    verdict: over
      ? `drug-name WER ${(report.drugNameWer * 100).toFixed(1)}% > ${(
          DRUG_NAME_WER_GATE * 100
        ).toFixed(0)}% — voice-Rx STAYS confirm-only (no relaxation)`
      : `drug-name WER ${(report.drugNameWer * 100).toFixed(1)}% ≤ ${(
          DRUG_NAME_WER_GATE * 100
        ).toFixed(0)}% — within gate (voice-Rx still ships confirm-first)`,
  };
}
