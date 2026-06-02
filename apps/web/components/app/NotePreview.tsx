'use client';

import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

interface Props {
  note: TherapyNoteV1;
  signedAt?: string | null;
  signedBy?: string | null;
}

/**
 * Renders a TherapyNoteV1 in a clinician-friendly long-form layout.
 *
 * Visual hierarchy:
 *   Summary             (subjective + objective as one prose block)
 *   Session Topics      (assessment broken into bullets)
 *   Plan                (plan as a checklist)
 *   Modality specifics  (optional, for CBT/EMDR-specific extracts)
 *   Phase hints         (small chips at the bottom)
 *
 * Sprint 4 introduces an editing toolbar + AI "modify your note" chat
 * panel that re-writes the underlying TherapyNoteV1 and surfaces a diff;
 * Sprint 7 layers note-type templates (BASE / SOAP / DAP) over this same
 * data shape. For now the layout is read-mostly with an inline edit
 * affordance per field.
 */
export function NotePreview({ note, signedAt, signedBy }: Props) {
  const topics = extractTopics(note.assessment);
  const planItems = extractTopics(note.plan);

  return (
    <article className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            disabled
            className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-2)] opacity-70"
            defaultValue="BASE"
            aria-label="Note type"
          >
            <option value="BASE">BASE</option>
            <option value="SOAP">SOAP</option>
            <option value="DAP">DAP</option>
          </select>
          <Badge tone="muted">{note.modality}</Badge>
          <Badge tone="muted">v{note.version}</Badge>
        </div>
        {signedAt ? (
          <div className="text-right text-xs text-[var(--color-ink-3)]">
            <p>
              <span className="font-medium text-[var(--color-accent)]">✓ Signed</span> ·{' '}
              {new Date(signedAt).toLocaleString()}
            </p>
            {signedBy && <p className="mt-0.5">by {signedBy}</p>}
          </div>
        ) : (
          <Badge tone="warn">Unsigned draft</Badge>
        )}
      </header>

      <Section heading="Summary">
        <p className="whitespace-pre-line">{note.subjective}</p>
        {note.objective.trim() && (
          <p className="mt-3 whitespace-pre-line text-[var(--color-ink-2)]">{note.objective}</p>
        )}
      </Section>

      <Section heading="Session Topics">
        {topics.length === 0 ? (
          <p className="text-[var(--color-ink-2)]">{note.assessment}</p>
        ) : (
          <ul className="space-y-2">
            {topics.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Plan">
        {planItems.length === 0 ? (
          <p className="text-[var(--color-ink-2)]">{note.plan}</p>
        ) : (
          <ul className="space-y-2">
            {planItems.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[var(--color-line)] bg-white text-[10px] text-[var(--color-ink-3)]"
                >
                  ◯
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {note.modalitySpecific && Object.keys(note.modalitySpecific).length > 0 && (
        <Section heading={`${note.modality} specifics`}>
          <pre className="overflow-x-auto rounded-xl bg-[var(--color-surface-soft)] p-4 text-xs text-[var(--color-ink-2)]">
            {JSON.stringify(note.modalitySpecific, null, 2)}
          </pre>
        </Section>
      )}

      {note.phaseHints.length > 0 && (
        <footer className="border-t border-[var(--color-line-soft)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Phase hints
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {note.phaseHints.map((h, i) => (
              <li key={i}>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1 text-xs">
                  <strong className="text-[var(--color-ink)]">{h.phase.replace(/_/g, ' ')}</strong>
                  <span className="text-[var(--color-ink-3)]">
                    · {(h.confidence * 100).toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-serif text-xl">{heading}</h3>
      <div className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink)]">{children}</div>
    </section>
  );
}

function extractTopics(block: string): string[] {
  const cleaned = block
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean);
  if (cleaned.length >= 2) return cleaned;
  // Fall back to splitting on sentence boundaries if the model returned one paragraph.
  const sentences = block
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return sentences.length >= 2 ? sentences : [];
}
