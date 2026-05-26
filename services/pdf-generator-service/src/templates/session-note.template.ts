import type { TherapyNoteV1 } from '@cureocity/contracts';
import { type Locale, t } from '../i18n/strings';
import { escapeHtml } from './escape';

export interface SessionNotePdfInput {
  note: TherapyNoteV1;
  clientFullName: string;
  sessionId: string;
  modality: string;
  scheduledAt: string;
  durationMs: number | null;
  signedBy: string | null;
  signedAt: string | null;
  locale: Locale;
}

export function renderSessionNoteHtml(input: SessionNotePdfInput): string {
  const { note, locale } = input;
  const durationMin = input.durationMs ? Math.round(input.durationMs / 60_000) : null;

  const indicators = note.riskFlags.indicators ?? [];
  const phaseHints = note.phaseHints ?? [];

  return baseHtml(
    t(locale, 'note.title'),
    `
    <header>
      <h1>${escapeHtml(t(locale, 'note.title'))}</h1>
      <div class="meta">
        <div><span class="k">${escapeHtml(t(locale, 'note.client'))}</span>${escapeHtml(input.clientFullName)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'note.session'))}</span>${escapeHtml(input.sessionId)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'note.modality'))}</span>${escapeHtml(input.modality)}</div>
        <div><span class="k">${escapeHtml(t(locale, 'note.scheduled'))}</span>${escapeHtml(input.scheduledAt)}</div>
        ${durationMin !== null ? `<div><span class="k">${escapeHtml(t(locale, 'note.duration'))}</span>${durationMin} min</div>` : ''}
      </div>
    </header>

    <section>
      <h2>${escapeHtml(t(locale, 'note.subjective'))}</h2>
      <p>${escapeHtml(note.subjective)}</p>
    </section>

    <section>
      <h2>${escapeHtml(t(locale, 'note.objective'))}</h2>
      <p>${escapeHtml(note.objective)}</p>
    </section>

    <section>
      <h2>${escapeHtml(t(locale, 'note.assessment'))}</h2>
      <p>${escapeHtml(note.assessment)}</p>
    </section>

    <section>
      <h2>${escapeHtml(t(locale, 'note.plan'))}</h2>
      <p>${escapeHtml(note.plan)}</p>
    </section>

    <section class="risk risk-${escapeHtml(note.riskFlags.severity)}">
      <h2>${escapeHtml(t(locale, 'note.riskHeader'))}</h2>
      <div><span class="k">${escapeHtml(t(locale, 'note.riskSeverity'))}</span><strong>${escapeHtml(note.riskFlags.severity.toUpperCase())}</strong></div>
      ${
        indicators.length > 0
          ? `<div><span class="k">${escapeHtml(t(locale, 'note.riskIndicators'))}</span>
               <ul>${indicators.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
             </div>`
          : ''
      }
      ${note.riskFlags.details ? `<p>${escapeHtml(note.riskFlags.details)}</p>` : ''}
    </section>

    ${
      phaseHints.length > 0
        ? `<section>
             <h2>${escapeHtml(t(locale, 'note.phaseHints'))}</h2>
             <ul>${phaseHints
               .map(
                 (h) =>
                   `<li><strong>${escapeHtml(h.phase)}</strong> (confidence ${(h.confidence * 100).toFixed(0)}%)${h.rationale ? ' — ' + escapeHtml(h.rationale) : ''}</li>`,
               )
               .join('')}</ul>
           </section>`
        : ''
    }

    <footer>
      ${
        input.signedBy && input.signedAt
          ? `<div><span class="k">${escapeHtml(t(locale, 'note.signedBy'))}</span>${escapeHtml(input.signedBy)}</div>
             <div><span class="k">${escapeHtml(t(locale, 'note.signedAt'))}</span>${escapeHtml(input.signedAt)}</div>`
          : ''
      }
      <div class="disclaimer">
        <strong>${escapeHtml(t(locale, 'note.disclaimerHeader'))}:</strong>
        ${escapeHtml(t(locale, 'note.disclaimerBody'))}
      </div>
    </footer>
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
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Inter', 'Noto Sans', sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 18pt; color: #0f3a5f; margin: 0 0 4mm; }
  h2 { font-size: 12pt; color: #0f3a5f; border-bottom: 1px solid #d4dde4; padding-bottom: 1mm; margin-top: 8mm; }
  header .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; font-size: 10pt; margin-bottom: 6mm; }
  .k { display: inline-block; color: #6b7280; min-width: 20mm; }
  section { margin-bottom: 4mm; }
  p { margin: 0 0 2mm; white-space: pre-wrap; }
  ul { margin: 1mm 0 2mm 5mm; padding: 0; }
  .risk { padding: 3mm 4mm; border-left: 3pt solid #6b7280; background: #f9fafb; }
  .risk-low { border-left-color: #84cc16; }
  .risk-medium { border-left-color: #eab308; }
  .risk-high { border-left-color: #f97316; background: #fff7ed; }
  .risk-critical { border-left-color: #dc2626; background: #fef2f2; }
  footer { margin-top: 10mm; font-size: 9pt; color: #6b7280; }
  footer .disclaimer { margin-top: 4mm; padding: 2mm 3mm; background: #f3f4f6; border-radius: 1mm; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
