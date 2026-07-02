import { ASR_FIXTURES, type AsrFixture } from './fixtures';
import type { IAsrEngine } from './engine';
import { aggregateAsr, asrGate, scoreAsrFixture, type AsrReport } from './scorer';

/** Run every fixture through the engine and score it. */
export async function runAsrEval(
  engine: IAsrEngine,
  fixtures: AsrFixture[] = ASR_FIXTURES,
): Promise<AsrReport> {
  const scores = [];
  for (const fixture of fixtures) {
    const hypothesis = await engine.transcribe(fixture);
    scores.push(scoreAsrFixture(fixture, hypothesis));
  }
  return aggregateAsr(scores, engine.name);
}

/** Human-readable report for the CLI. */
export function formatAsrReport(report: AsrReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`ASR benchmark — engine=${report.engine} — ${report.total} consults`);
  lines.push('');
  for (const s of report.scores) {
    const flag = s.drugMissed > 0 ? '⚠' : '·';
    lines.push(
      `  ${flag} ${s.id.padEnd(12)} [${s.domain}/${s.language}] ` +
        `WER=${pct(s.wer)} drugWER=${pct(s.drugTer)} medWER=${pct(s.medicalTer)}` +
        (s.drugMisses.length ? ` — dropped: ${s.drugMisses.join(', ')}` : ''),
    );
  }
  lines.push('');
  for (const [lang, agg] of Object.entries(report.byLanguage)) {
    lines.push(`  ${lang}: WER ${pct(agg.wer)} · drug-name WER ${pct(agg.drugNameWer)} (${agg.n})`);
  }
  lines.push('');
  lines.push(
    `Overall: WER ${pct(report.meanWer)} · medical WER ${pct(report.medicalWer)} · ` +
      `DRUG-NAME WER ${pct(report.drugNameWer)}`,
  );
  const gate = asrGate(report);
  lines.push('');
  lines.push(`GATE: ${gate.verdict}`);
  return lines.join('\n');
}
