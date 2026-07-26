import { describe, expect, it } from 'vitest';
import {
  allergyWarningsByDrug,
  checkAllergies,
  formatAllergyAlert,
  hasBlockingAllergy,
} from './allergies';

describe('checkAllergies — the case this engine exists for', () => {
  it('flags amoxicillin against a recorded penicillin allergy', () => {
    const alerts = checkAllergies(['Amoxicillin 500mg TDS'], ['Penicillin']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('contraindicated');
    expect(alerts[0]!.match).toBe('class');
    expect(hasBlockingAllergy(alerts)).toBe(true);
  });

  it('flags an Indian brand name (Augmentin) against a penicillin allergy', () => {
    const alerts = checkAllergies(['Augmentin 625'], ['allergic to penicillin']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('contraindicated');
  });

  it('flags the exact recorded drug as a direct match', () => {
    const alerts = checkAllergies(['Ibuprofen 400'], ['ibuprofen — rash']);
    expect(alerts[0]!.match).toBe('direct');
    expect(alerts[0]!.severity).toBe('contraindicated');
  });

  it('flags a class allergy recorded as a class ("NSAIDs")', () => {
    const alerts = checkAllergies(['Diclofenac 50mg BD'], ['NSAIDs']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.matched).toBe('NSAIDs');
  });

  it('flags cotrimoxazole against a "sulfa" allergy', () => {
    const alerts = checkAllergies(['Cotrimoxazole DS'], ['sulfa drugs']);
    expect(alerts[0]!.severity).toBe('contraindicated');
  });
});

describe('checkAllergies — cross-reactivity is graded, not absolute', () => {
  it('flags a cephalosporin against a penicillin allergy as MAJOR, not contraindicated', () => {
    const alerts = checkAllergies(['Cefixime 200'], ['Penicillin']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('major');
    expect(alerts[0]!.match).toBe('cross-reactive');
    // Graded severity matters: this must NOT block a signature outright.
    expect(hasBlockingAllergy(alerts)).toBe(false);
  });
});

describe('checkAllergies — false alarms are as harmful as misses', () => {
  it('does NOT flag a thiazide or furosemide against a sulfa-antibiotic allergy', () => {
    // The classic over-warn. Non-antibiotic sulfonamides do not meaningfully
    // cross-react; warning here trains prescribers to ignore the engine.
    expect(checkAllergies(['Hydrochlorothiazide 12.5'], ['sulfa'])).toHaveLength(0);
    expect(checkAllergies(['Furosemide 40mg'], ['sulfa drugs'])).toHaveLength(0);
  });

  it('says nothing about drugs it does not recognise', () => {
    expect(checkAllergies(['Zibblewort 10mg'], ['Penicillin'])).toHaveLength(0);
  });

  it('treats "no known drug allergies" as no allergen', () => {
    expect(checkAllergies(['Amoxicillin 500'], ['No known drug allergies'])).toHaveLength(0);
    expect(checkAllergies(['Amoxicillin 500'], ['NKDA'])).toHaveLength(0);
    expect(checkAllergies(['Amoxicillin 500'], ['nil'])).toHaveLength(0);
    expect(checkAllergies(['Amoxicillin 500'], [''])).toHaveLength(0);
  });

  it('does not match a token inside a longer word', () => {
    // "mox" is a real brand, but must not fire on "amoxicillin" twice or on
    // an unrelated word containing it.
    const alerts = checkAllergies(['Moxifloxacin 400'], ['Penicillin']);
    expect(alerts).toHaveLength(0);
  });

  it('returns nothing when the patient has no recorded allergies', () => {
    expect(checkAllergies(['Amoxicillin 500'], [])).toHaveLength(0);
  });
});

describe('allergyWarningsByDrug — aligned to the prescription order', () => {
  it('stamps warnings on the offending row only', () => {
    const drugs = ['Paracetamol 650', 'Amoxicillin 500', 'Pantoprazole 40'];
    const rows = allergyWarningsByDrug(drugs, ['Penicillin']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveLength(0);
    expect(rows[1]!.length).toBeGreaterThan(0);
    expect(rows[2]).toHaveLength(0);
    expect(rows[1]![0]).toContain('DO NOT PRESCRIBE');
  });

  it('formats a readable, citation-bearing line', () => {
    const [alert] = checkAllergies(['Amoxicillin 500'], ['Penicillin']);
    const line = formatAllergyAlert(alert!);
    expect(line).toContain('Amoxicillin 500');
    expect(line).toContain('Penicillin');
    expect(line).toContain('[');
  });
});
