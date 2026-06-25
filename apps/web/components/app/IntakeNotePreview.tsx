'use client';

import type { IntakeNoteV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { EduSection } from './EduHeading';

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

      <EduSection term="intake.presentingConcerns">
        <p className="whitespace-pre-line">{note.presentingConcerns}</p>
      </EduSection>

      <EduSection term="intake.hpi">
        <p className="whitespace-pre-line">{note.historyOfPresentingIllness}</p>
      </EduSection>

      {note.pastPsychiatricHistory.trim() && (
        <EduSection term="intake.pastPsychiatricHistory">
          <p className="whitespace-pre-line">{note.pastPsychiatricHistory}</p>
        </EduSection>
      )}

      {note.familyHistory.trim() && (
        <EduSection term="intake.familyHistory">
          <p className="whitespace-pre-line">{note.familyHistory}</p>
        </EduSection>
      )}

      {note.socialHistory.trim() && (
        <EduSection term="intake.socialHistory">
          <p className="whitespace-pre-line">{note.socialHistory}</p>
        </EduSection>
      )}

      <EduSection term="intake.mentalStatusExam">
        <p className="whitespace-pre-line">{note.mentalStatusExam}</p>
      </EduSection>

      <EduSection term="intake.workingHypothesis">
        <p className="whitespace-pre-line">{note.workingHypothesis}</p>
      </EduSection>

      <EduSection term="intake.immediatePlan">
        <p className="whitespace-pre-line">{note.immediatePlan}</p>
      </EduSection>
    </article>
  );
}
