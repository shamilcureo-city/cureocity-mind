import { describe, expect, it } from 'vitest';
import { screenForCrisis } from './crisis-screen';

describe('screenForCrisis (deterministic, clinician-reviewed lists)', () => {
  it('flags direct English self-harm statements', () => {
    const r = screenForCrisis(['some days I just want to die, honestly']);
    expect(r.hit).toBe(true);
    expect(r.matches[0]!.language).toBe('en');
  });

  it('flags English regardless of case', () => {
    expect(screenForCrisis(['I WANT TO DIE']).hit).toBe(true);
    expect(screenForCrisis(['thinking about Suicide again']).hit).toBe(true);
  });

  it('flags Hinglish transliterations', () => {
    expect(screenForCrisis(['kabhi kabhi lagta hai khudkushi hi raasta hai']).hit).toBe(true);
    expect(screenForCrisis(['main marna chahta hoon bas']).hit).toBe(true);
  });

  it('flags Devanagari phrases', () => {
    const r = screenForCrisis(['मुझे लगता है आत्महत्या ही रास्ता है']);
    expect(r.hit).toBe(true);
    expect(r.matches[0]!.language).toBe('hi');
  });

  it('flags Malayalam script and Manglish', () => {
    expect(screenForCrisis(['ചിലപ്പോൾ മരിക്കണം എന്നു തോന്നും']).hit).toBe(true);
    expect(screenForCrisis(['chilappol marikkanam ennu thonnum']).hit).toBe(true);
  });

  it('flags harm-to-others statements', () => {
    expect(screenForCrisis(['I swear I am going to hurt someone at that office']).hit).toBe(true);
  });

  it('screens across a batch and collects every match', () => {
    const r = screenForCrisis([
      'work was fine today',
      'but honestly I think about self harm',
      'aur kabhi jaan dena bhi sochta hoon',
    ]);
    expect(r.hit).toBe(true);
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT flag ordinary distress language', () => {
    const r = screenForCrisis([
      'I am so tired of this job',
      'the deadline is killing my weekend plans, we had to kill the feature',
      'I could not sleep at all and I feel dead tired',
      'ee week valare kashtamayirunnu',
      'bahut mushkil hafta tha yaar',
    ]);
    expect(r.hit).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it('handles empty input safely', () => {
    expect(screenForCrisis([]).hit).toBe(false);
    expect(screenForCrisis(['']).hit).toBe(false);
  });
});
