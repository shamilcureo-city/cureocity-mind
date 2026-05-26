import { describe, it, expect } from 'vitest';
import { renderTreatmentPlanHtml } from './treatment-plan.template';

describe('renderTreatmentPlanHtml', () => {
  const baseInput = {
    clientFullName: 'Arjun Rao',
    psychologistFullName: 'Dr. Priya Menon',
    modality: 'CBT',
    currentPhase: 'cognitive_restructuring',
    goals: [
      { description: 'Reduce work-related anxiety', achieved: false },
      { description: 'Improve sleep', achieved: true },
    ],
    exercises: [
      {
        title: 'cbt thought record 5col',
        description: 'Try one thought record this week.',
        dueAt: '2026-06-08',
      },
    ],
    locale: 'en' as const,
  };

  it('renders client-facing plan with goals + exercises + crisis line', () => {
    const html = renderTreatmentPlanHtml(baseInput);
    expect(html).toContain('Treatment Plan');
    expect(html).toContain('Reduce work-related anxiety');
    expect(html).toContain('cbt thought record 5col');
    expect(html).toContain('iCall: 9152987821');
    expect(html).toContain('cognitive restructuring'); // underscores replaced
  });

  it('shows ✓ for achieved goals and ○ for not', () => {
    const html = renderTreatmentPlanHtml(baseInput);
    expect(html).toMatch(/○.*Reduce work-related anxiety/);
    expect(html).toMatch(/✓.*Improve sleep/);
  });

  it('drops exercises section when empty', () => {
    const html = renderTreatmentPlanHtml({ ...baseInput, exercises: [] });
    expect(html).not.toContain('Between-session practice');
  });

  it('uses Hindi labels for crisis info when locale=hi', () => {
    const html = renderTreatmentPlanHtml({ ...baseInput, locale: 'hi' });
    expect(html).toContain('iCall: 9152987821');
    expect(html).toContain('आपातकाल'); // emergency
  });
});
