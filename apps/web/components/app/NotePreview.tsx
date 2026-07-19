'use client';

import type { ReactNode } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import type { NoteVerbosity } from '../../lib/note-format';
import { formatIstDateTime } from '../../lib/ist';

interface Props {
  note: TherapyNoteV1;
  signedAt?: string | null;
  signedBy?: string | null;
  /** View density — controlled by the toolbar's "Detailed" dropdown. */
  verbosity?: NoteVerbosity;
}

/**
 * Clean note renderer (Sprint 70 redesign) — a plain "Summary" + named
 * "Session topics" (or the chosen template's sections), then "The plan".
 *
 * Deliberately minimal: no format/verbosity controls, badges, or education
 * annotations live here — the toolbar carries the controls and the Learn
 * Center carries the teaching. This component is just the note.
 */
export function NotePreview({ note, signedAt, signedBy, verbosity = 'DETAILED' }: Props) {
  const hasSummary = Boolean(note.summary && note.summary.trim());
  const hasNamedTopics = Boolean(note.topics && note.topics.length > 0);
  const hasTemplateSections = Boolean(note.templateSections && note.templateSections.length > 0);
  const assessmentTopics = extractTopics(note.assessment);
  const planItems = extractTopics(note.plan);

  // A note generated into a chosen template renders that template's sections.
  if (hasTemplateSections) {
    return (
      <article className="space-y-7">
        {note.templateSections!.map((s, i) => (
          <Section key={i} heading={s.title}>
            <p className="whitespace-pre-line">{s.body.trim() ? s.body : '—'}</p>
          </Section>
        ))}
        <SignedFooter signedAt={signedAt} signedBy={signedBy} />
      </article>
    );
  }

  return (
    <article className="space-y-7">
      <Section heading="Summary">
        {hasSummary ? (
          <p className="whitespace-pre-line">{note.summary}</p>
        ) : (
          <>
            <p className="whitespace-pre-line">{note.subjective}</p>
            {note.objective.trim() && (
              <p className="mt-3 whitespace-pre-line text-[var(--color-ink-2)]">{note.objective}</p>
            )}
          </>
        )}
      </Section>

      {verbosity !== 'BRIEF' && (
        <Section heading="Session topics">
          {hasNamedTopics ? (
            <div className="space-y-5">
              {note.topics!.map((t, i) => (
                <div key={i}>
                  <h4 className="text-lg font-bold text-[var(--color-ink)]">{t.title}</h4>
                  {t.points.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {t.points.map((p, j) => (
                        <li key={j} className="flex items-start gap-2">
                          <Dot />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : assessmentTopics.length === 0 ? (
            <p className="whitespace-pre-line text-[var(--color-ink-2)]">{note.assessment}</p>
          ) : (
            <ul className="space-y-2">
              {assessmentTopics.map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Dot />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section heading="The plan">
        {planItems.length === 0 ? (
          <p className="whitespace-pre-line text-[var(--color-ink-2)]">{note.plan}</p>
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

      {verbosity === 'VERY_DETAILED' && (hasSummary || hasNamedTopics) && (
        <Section heading="Full clinical detail">
          <div className="space-y-3 text-sm text-[var(--color-ink-2)]">
            <p className="whitespace-pre-line">
              <strong className="text-[var(--color-ink)]">Subjective · </strong>
              {note.subjective}
            </p>
            {note.objective.trim() && (
              <p className="whitespace-pre-line">
                <strong className="text-[var(--color-ink)]">Objective · </strong>
                {note.objective}
              </p>
            )}
            <p className="whitespace-pre-line">
              <strong className="text-[var(--color-ink)]">Assessment · </strong>
              {note.assessment}
            </p>
          </div>
        </Section>
      )}

      <SignedFooter signedAt={signedAt} signedBy={signedBy} />
    </article>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-2xl font-bold tracking-tight text-[var(--color-ink)]">{heading}</h3>
      <div className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink)]">{children}</div>
    </section>
  );
}

function Dot() {
  return (
    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ink-3)]" />
  );
}

function SignedFooter({
  signedAt,
  signedBy,
}: {
  signedAt?: string | null;
  signedBy?: string | null;
}) {
  if (!signedAt) return null;
  return (
    <p className="border-t border-[var(--color-line-soft)] pt-4 text-xs text-[var(--color-ink-3)]">
      ✓ Signed{signedBy ? ` by ${signedBy}` : ''} · {formatIstDateTime(signedAt)}
    </p>
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
