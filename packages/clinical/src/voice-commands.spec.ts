import { describe, expect, it } from 'vitest';
import { parseVoiceCommands } from './voice-commands';

describe('parseVoiceCommands — ADD_MEDICATION', () => {
  it('parses "add paracetamol 500 TDS x 3 days"', () => {
    const [cmd] = parseVoiceCommands('Okay. Add paracetamol 500 mg TDS x 3 days.');
    expect(cmd).toMatchObject({
      kind: 'ADD_MEDICATION',
      drug: 'Paracetamol',
      strength: '500 mg',
      frequency: 'three times daily',
      durationDays: 3,
    });
  });

  it('converts weeks to days', () => {
    const [cmd] = parseVoiceCommands('Start amoxicillin 500mg BD for 1 week.');
    expect(cmd).toMatchObject({
      kind: 'ADD_MEDICATION',
      durationDays: 7,
      frequency: 'twice daily',
    });
  });

  it('strips "tablet" from the drug name', () => {
    const [cmd] = parseVoiceCommands('Prescribe tablet atorvastatin 40 mg HS.');
    expect(cmd).toMatchObject({
      kind: 'ADD_MEDICATION',
      drug: 'Atorvastatin',
      frequency: 'at night',
    });
  });

  it('does NOT fire on "add" without a dosing signal', () => {
    expect(parseVoiceCommands('Let me add a note about the family history.')).toEqual([]);
  });
});

describe('parseVoiceCommands — ORDER_TEST', () => {
  it('parses "order ECG"', () => {
    const [cmd] = parseVoiceCommands('Let us order ECG today.');
    expect(cmd).toMatchObject({ kind: 'ORDER_TEST', description: 'Ecg' });
  });

  it('parses "send for a lipid profile"', () => {
    const [cmd] = parseVoiceCommands('I will send for a lipid profile.');
    expect(cmd).toMatchObject({ kind: 'ORDER_TEST', description: 'Lipid Profile' });
  });

  it('does not fire on an order verb without a known test', () => {
    expect(parseVoiceCommands('Please order your priorities at home.')).toEqual([]);
  });
});

describe('parseVoiceCommands — SHOW_DATA', () => {
  it('parses "show last HbA1c"', () => {
    const [cmd] = parseVoiceCommands('Show last HbA1c please.');
    expect(cmd).toMatchObject({ kind: 'SHOW_DATA', measure: 'HBA1C' });
  });

  it('parses "what was the last BP"', () => {
    const [cmd] = parseVoiceCommands('What was the last BP reading?');
    expect(cmd).toMatchObject({ kind: 'SHOW_DATA', measure: 'BP' });
  });
});

describe('parseVoiceCommands — general', () => {
  it('finds multiple commands across a transcript and dedupes', () => {
    const cmds = parseVoiceCommands(
      'Add paracetamol 500 mg TDS x 3 days. Order ECG. Add paracetamol 500 mg TDS x 3 days.',
    );
    expect(cmds).toHaveLength(2);
  });

  it('returns [] for ordinary conversation', () => {
    expect(parseVoiceCommands('How are you feeling today? The weather is nice.')).toEqual([]);
  });
});
