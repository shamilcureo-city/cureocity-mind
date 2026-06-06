'use client';

import type { IntakeNoteV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

interface Props {
  note: IntakeNoteV1;
  signedAt?: string | null;
  signedBy?: string | null;
}

/**
 * Sprint 19 — Intake-note read view.
 *
 * Sibling to NotePreview. TherapyNoteV1 (SOAP) doesn't fit a first
 * session — the therapist hasn't formed an assessment or plan yet —
 * so an intake produces IntakeNoteV1 with the standard intake
 * sections: presenting concerns, history of present illness, past
 * psychiatric history, family + social history, mental status exam,
 * working hypothesis, immediate plan.
 *
 * Read-only in v1. Sign-off + AI modify-panel are deferred until the
 * intake contract has the equivalent edit + verification surface area
 * (TherapyNote has it; IntakeNote does not yet).
 */
export function IntakeNotePreview({ note, signedAt, signedBy }: Props) {
  return (
    <article className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone="accent">Intake note</Badge>
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

      <Section heading="Presenting concerns">
        <p className="whitespace-pre-line">{note.presentingConcerns}</p>
      </Section>

      <Section heading="History of present illness">
        <p className="whitespace-pre-line">{note.historyOfPresentingIllness}</p>
      </Section>

      {note.pastPsychiatricHistory.trim() && (
        <Section heading="Past psychiatric history">
          <p className="whitespace-pre-line">{note.pastPsychiatricHistory}</p>
        </Section>
      )}

      {note.familyHistory.trim() && (
        <Section heading="Family history">
          <p className="whitespace-pre-line">{note.familyHistory}</p>
        </Section>
      )}

      {note.socialHistory.trim() && (
        <Section heading="Social history">
          <p className="whitespace-pre-line">{note.socialHistory}</p>
        </Section>
      )}

      <Section heading="Mental status exam">
        <p className="whitespace-pre-line">{note.mentalStatusExam}</p>
      </Section>

      <Section heading="Working hypothesis">
        <p className="whitespace-pre-line">{note.workingHypothesis}</p>
        <p className="mt-2 text-xs italic text-[var(--color-ink-3)]">
          The Pass 3 initial-assessment brief expands this into a differential with citations.
        </p>
      </Section>

      <Section heading="Immediate plan">
        <p className="whitespace-pre-line">{note.immediatePlan}</p>
      </Section>
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
