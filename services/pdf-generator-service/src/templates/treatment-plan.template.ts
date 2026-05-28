import { type Locale, t } from '../i18n/strings';
import { escapeHtml } from './escape';

export interface TreatmentPlanGoal {
  description: string;
  achieved: boolean;
}

export interface TreatmentPlanExercise {
  title: string;
  description: string;
  dueAt: string | null;
}

export interface TreatmentPlanPdfInput {
  clientFullName: string;
  psychologistFullName: string;
  modality: string;
  currentPhase: string;
  goals: TreatmentPlanGoal[];
  exercises: TreatmentPlanExercise[];
  locale: Locale;
}

/**
 * Client-facing treatment plan. Stripped-down plain-language version of
 * the clinical note. NO clinical jargon, NO risk flags surfaced directly
 * — only the goals + practice + crisis info the client needs.
 */
export function renderTreatmentPlanHtml(input: TreatmentPlanPdfInput): string {
  const { locale } = input;

  return baseHtml(
    t(locale, 'plan.title'),
    `
    <header>
      <h1>${escapeHtml(t(locale, 'plan.title'))}</h1>
      <div class="meta">
        <div><span class="k">${escapeHtml(t(locale, 'plan.preparedFor'))}</span>${escapeHtml(input.clientFullName)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'plan.preparedBy'))}</span>${escapeHtml(input.psychologistFullName)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'plan.modality'))}</span>${escapeHtml(input.modality)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'plan.currentPhase'))}</span>${escapeHtml(input.currentPhase.replace(/_/g, ' '))}</div>
      </div>
    </header>

    <section>
      <h2>${escapeHtml(t(locale, 'plan.goals'))}</h2>
      <ul class="goals">
        ${input.goals
          .map(
            (g) =>
              `<li><span class="check">${g.achieved ? '✓' : '○'}</span> ${escapeHtml(g.description)}</li>`,
          )
          .join('')}
      </ul>
    </section>

    ${
      input.exercises.length > 0
        ? `<section>
             <h2>${escapeHtml(t(locale, 'plan.exercisesHeader'))}</h2>
             <ul class="exercises">
               ${input.exercises
                 .map(
                   (e) => `<li>
                     <strong>${escapeHtml(e.title)}</strong>
                     ${e.dueAt ? `<span class="due">${escapeHtml(t(locale, 'plan.exerciseDue'))}: ${escapeHtml(e.dueAt)}</span>` : ''}
                     <div class="desc">${escapeHtml(e.description)}</div>
                   </li>`,
                 )
                 .join('')}
             </ul>
           </section>`
        : ''
    }

    <section class="crisis">
      <h2>${escapeHtml(t(locale, 'plan.crisisHeader'))}</h2>
      <p>${escapeHtml(t(locale, 'plan.crisisBody'))}</p>
    </section>

    <footer>${escapeHtml(t(locale, 'plan.footer'))}</footer>
    `,
  );
}

function baseHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: 'Inter', 'Noto Sans', sans-serif; color: #1f2937; font-size: 12pt; line-height: 1.6; }
  h1 { font-size: 22pt; color: #0f3a5f; margin: 0 0 6mm; }
  h2 { font-size: 13pt; color: #0f3a5f; margin-top: 10mm; margin-bottom: 3mm; }
  header .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; font-size: 10pt; }
  .k { display: inline-block; color: #6b7280; min-width: 28mm; }
  ul.goals, ul.exercises { list-style: none; margin: 0; padding: 0; }
  ul.goals li { margin-bottom: 3mm; }
  ul.goals .check { display: inline-block; width: 6mm; font-weight: 600; color: #0f3a5f; }
  ul.exercises li { margin-bottom: 5mm; padding: 3mm 4mm; background: #f9fafb; border-left: 3pt solid #0f3a5f; }
  ul.exercises .due { margin-left: 4mm; color: #6b7280; font-size: 10pt; }
  ul.exercises .desc { margin-top: 2mm; }
  section.crisis { margin-top: 12mm; padding: 4mm 5mm; background: #fff7ed; border-left: 3pt solid #f97316; }
  footer { margin-top: 14mm; font-size: 10pt; color: #6b7280; font-style: italic; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
