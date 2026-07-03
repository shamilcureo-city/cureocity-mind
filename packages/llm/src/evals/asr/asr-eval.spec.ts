import { describe, expect, it } from 'vitest';
import { editDistance, termErrorRate, tokenize, wordErrorRate } from './wer';
import { MockAsrEngine } from './engine';
import { aggregateAsr, asrGate, DRUG_NAME_WER_GATE } from './scorer';
import { runAsrEval } from './runner';
import { ASR_FIXTURES, type AsrFixture } from './fixtures';

describe('WER primitives', () => {
  it('is zero for identical strings', () => {
    expect(wordErrorRate('take aspirin at night', 'take aspirin at night').wer).toBe(0);
  });

  it('normalises casing + punctuation', () => {
    expect(wordErrorRate('Take aspirin, at night.', 'take aspirin at night').wer).toBe(0);
  });

  it('counts one substitution out of four words as 0.25', () => {
    const r = wordErrorRate('take aspirin at night', 'take atenolol at night');
    expect(r.wer).toBeCloseTo(0.25, 5);
  });

  it('edit distance counts indels', () => {
    expect(editDistance(tokenize('a b c'), tokenize('a c'))).toBe(1);
    expect(editDistance(tokenize('a c'), tokenize('a b c'))).toBe(1);
  });
});

describe('term error rate (drug names)', () => {
  it('is zero when every drug survives', () => {
    const r = termErrorRate('start aspirin and metformin', 'start aspirin and metformin', [
      'aspirin',
      'metformin',
    ]);
    expect(r.ter).toBe(0);
    expect(r.total).toBe(2);
  });

  it('flags a mangled drug name as a miss', () => {
    const r = termErrorRate('start telmisartan today', 'start telmisartion today', ['telmisartan']);
    expect(r.missed).toBe(1);
    expect(r.ter).toBe(1);
  });

  it('handles multi-word terms + ignores terms absent from the reference', () => {
    const r = termErrorRate('check the blood pressure', 'check the blood pressure', [
      'blood pressure',
      'troponin',
    ]);
    expect(r.total).toBe(1); // only "blood pressure" occurs
    expect(r.ter).toBe(0);
  });
});

describe('ASR gate', () => {
  function reportWithDrugWer(drugMissed: number, drugTotal: number) {
    const scores = [
      {
        id: 'x',
        domain: 'gp' as const,
        language: 'en' as const,
        wer: 0,
        drugTer: drugMissed / drugTotal,
        medicalTer: 0,
        drugTotal,
        drugMissed,
        medicalTotal: 0,
        medicalMissed: 0,
        drugMisses: [],
      },
    ];
    return aggregateAsr(scores, 'mock');
  }

  it('keeps voice-Rx confirm-only when drug-name WER exceeds 3%', () => {
    const gate = asrGate(reportWithDrugWer(1, 10)); // 10%
    expect(gate.voiceRxConfirmOnly).toBe(true);
  });

  it('does not force confirm-only at or below the 3% gate', () => {
    const gate = asrGate(reportWithDrugWer(0, 100)); // 0%
    expect(gate.voiceRxConfirmOnly).toBe(false);
    expect(DRUG_NAME_WER_GATE).toBe(0.03);
  });
});

describe('ASR seed set', () => {
  it('every fixture reference actually contains its listed drugs', () => {
    for (const f of ASR_FIXTURES as AsrFixture[]) {
      for (const drug of f.drugs) {
        const r = termErrorRate(f.reference, f.reference, [drug]);
        expect(r.total, `${f.id} lists drug "${drug}" not in its reference`).toBeGreaterThan(0);
      }
    }
  });

  it('runs end-to-end through the mock engine + produces a gate verdict', async () => {
    const report = await runAsrEval(new MockAsrEngine());
    expect(report.total).toBe(ASR_FIXTURES.length);
    expect(report.drugNameWer).toBeGreaterThanOrEqual(0);
    const gate = asrGate(report);
    expect(typeof gate.voiceRxConfirmOnly).toBe('boolean');
    expect(gate.verdict).toContain('drug-name WER');
  });
});
