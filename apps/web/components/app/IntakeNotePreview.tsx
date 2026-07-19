'use client';

import type { ReactNode } from 'react';
import type { IntakeNoteV1 } from '@cureocity/contracts';
import type { NoteVerbosity } from '../../lib/note-format';
import { formatIstDateTime } from '../../lib/ist';

interface Props {
  note: IntakeNoteV1;
  signedAt?: string | null;
  signedBy?: string | null;
  /** View density — controlled by the toolbar's "Detailed" dropdown. */
  verbosity?: NoteVerbosity;
}

/**
 * Clean intake-note renderer — the same plain "Section" layout as the
 * treatment NotePreview (bold sans headings, no badges, no clinical-term
 * subtitles, no inline "What's this?" — education lives in the Learn Center).
 * Renders the standard intake sections under therapist-friendly headings.
 */
export function IntakeNotePreview({ note, signedAt, signedBy, verbosity = 'DETAILED' }: Props) {
  // BRIEF shows just the core of the intake; DETAILED/VERY_DETAILED add the
  // optional history sections (skipping any that are empty).
  const brief = verbosity === 'BRIEF';
  const hasTemplateSections = Boolean(note.templateSections && note.templateSections.length > 0);

  // Sprint 72 — an intake generated into a chosen template renders that
  // template's sections. The eight canonical fields stay authoritative
  // underneath (assessment brief / sign-off / PDF read them).
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
      <Section heading="Why they came">
        <p className="whitespace-pre-line">{note.presentingConcerns}</p>
      </Section>

      <Section heading="The story so far">
        <p className="whitespace-pre-line">{note.historyOfPresentingIllness}</p>
      </Section>

      {!brief && note.pastPsychiatricHistory.trim() && (
        <Section heading="Past mental-health care">
          <p className="whitespace-pre-line">{note.pastPsychiatricHistory}</p>
        </Section>
      )}

      {!brief && note.familyHistory.trim() && (
        <Section heading="Family background">
          <p className="whitespace-pre-line">{note.familyHistory}</p>
        </Section>
      )}

      {!brief && note.socialHistory.trim() && (
        <Section heading="Life & circumstances">
          <p className="whitespace-pre-line">{note.socialHistory}</p>
        </Section>
      )}

      {!brief && (
        <Section heading="Mental state today">
          <p className="whitespace-pre-line">{note.mentalStatusExam}</p>
        </Section>
      )}

      <Section heading="Working hypothesis">
        <p className="whitespace-pre-line">{note.workingHypothesis}</p>
      </Section>

      <Section heading="The plan">
        <p className="whitespace-pre-line">{note.immediatePlan}</p>
      </Section>

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
