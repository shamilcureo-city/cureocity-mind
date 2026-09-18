import Link from 'next/link';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { ScheduleSessionPanel } from './ScheduleSessionPanel';
import { MindCloseoutDecisionActions } from './MindCloseoutDecisionActions';
import { MindSessionAgreements } from './MindSessionAgreements';
import { MindCareRecordPanel } from './MindCareRecordPanel';
import { MindWorkHistory } from './MindWorkHistory';
import { ShareReceiptList, type ShareReceiptView } from './ShareReceiptList';
import { suggestFollowUp } from '../../lib/follow-up-suggestion';
import styles from './MindSessionReview.module.css';

interface Props {
  sessionId: string;
  closeout: MindSessionCloseout;
  client: {
    id: string;
    fullName: string;
    preferredModality: string | null;
  };
  sessionAt: Date;
  followUpSession?: { id: string; scheduledAt: string } | null;
  sessionCompleted: boolean;
  canShare: boolean;
  agreementCount?: number;
  selectedQuestionCount?: number;
  receipts: ShareReceiptView[];
  children: React.ReactNode;
  clinicalReview?: React.ReactNode;
  canReviewClinical?: boolean;
  canRecordWork?: boolean;
  initialReviewOpen?: boolean;
  hasSignedNote?: boolean;
  decisionActions?: React.ReactNode;
}

export function MindSessionCloseout({
  sessionId,
  closeout,
  client,
  sessionAt,
  followUpSession,
  sessionCompleted,
  canShare,
  agreementCount = 0,
  selectedQuestionCount = 0,
  receipts,
  children,
  clinicalReview,
  canReviewClinical = true,
  canRecordWork = false,
  initialReviewOpen = false,
  hasSignedNote,
  decisionActions,
}: Props) {
  if (!sessionCompleted) return <>{children}</>;
  const suggestedFollowUp = suggestFollowUp(sessionAt);
  const signed = closeout.steps.signed === 'COMPLETE';
  const noteReady = closeout.steps.noteGenerated === 'COMPLETE';
  const noteFailed = closeout.status === 'NEEDS_ATTENTION';
  const noteGenerating = closeout.status === 'GENERATING';
  const reopened = hasSignedNote === true && !signed;
  const clinicalState = closeout.steps.clinicalSuggestions;
  const hasNextSessionMaterial =
    agreementCount > 0 || selectedQuestionCount > 0 || followUpSession != null;
  return (
    <section className={styles.closeoutShell} aria-labelledby="mind-closeout-title">
      <div className={styles.noteLead}>
        <div>
          <h2 id="mind-closeout-title">Review the clinical note</h2>
          <p>
            {signed
              ? 'Your signed note is saved. Its signature does not send anything to the client.'
              : reopened
                ? 'This previously signed note is open for correction. Review the updated version, then re-lock it.'
                : noteFailed
                  ? 'The note could not be prepared. Resolve the generation error or document manually before signing.'
                  : noteGenerating
                    ? 'The note is still being prepared from the saved session material. Review and signing will be available when it is ready.'
                    : 'This draft was prepared from the saved session material. Check it against the session before signing, or leave it as a saved unsigned draft.'}
          </p>
        </div>
        {canReviewClinical && (
          <Link
            href={`/app/sessions/${sessionId}?tab=note&support=clinical#session-support`}
            className={styles.contextLink}
          >
            Open clinical support
          </Link>
        )}
      </div>

      <div className={styles.reviewGrid}>
        <div className={styles.noteColumn} id="mind-note-review">
          {children}
        </div>

        <aside className={styles.finish} aria-labelledby="before-finish-title">
          <h2 className={styles.finishTitle} id="before-finish-title">
            Before you finish
          </h2>
          <p className={styles.finishIntro}>
            {signed
              ? 'The clinical record is signed. Everything below remains optional.'
              : reopened
                ? 'Review the correction and re-lock the clinical record. Everything below remains optional.'
                : noteFailed
                  ? 'The clinical note needs attention before it can be reviewed. Optional planning can wait.'
                  : noteGenerating
                    ? 'The clinical note is still being prepared. Optional planning can wait.'
                    : 'The note is the only required review. Clinical support and next-session planning are optional.'}
          </p>

          <ol className={styles.finishChecklist} aria-label="Review status">
            <li className={styles.finishRow}>
              <span className={styles.finishMarker} aria-hidden="true">
                {signed ? '✓' : '1'}
              </span>
              <span className={styles.finishCopy}>
                <strong>Clinical note</strong>
                <small>
                  {signed
                    ? 'Signed clinical record'
                    : reopened
                      ? 'Review corrections and re-lock'
                      : noteFailed
                        ? 'Resolve the note generation error'
                        : noteGenerating
                          ? 'Wait for the saved draft'
                          : 'Read and confirm its accuracy'}
                </small>
              </span>
              <span
                className={`${styles.statusTag} ${signed ? styles.statusDone : styles.statusRequired}`}
              >
                {signed
                  ? 'Signed'
                  : reopened
                    ? 'Re-lock'
                    : noteFailed
                      ? 'Needs attention'
                      : noteGenerating
                        ? 'Preparing'
                        : 'Required'}
              </span>
            </li>

            {canReviewClinical && (
              <li className={styles.finishRow}>
                <span className={styles.finishMarker} aria-hidden="true">
                  {clinicalState === 'COMPLETE' ? '✓' : '2'}
                </span>
                <span className={styles.finishCopy}>
                  <strong>Clinical support</strong>
                  <small>Diagnostic evidence and questions</small>
                </span>
                <span
                  className={`${styles.statusTag} ${clinicalState === 'COMPLETE' ? styles.statusDone : styles.statusOptional}`}
                >
                  {clinicalState === 'COMPLETE'
                    ? 'Reviewed'
                    : clinicalState === 'SKIPPED'
                      ? 'Not needed'
                      : 'Optional'}
                </span>
              </li>
            )}

            <li className={styles.finishRow}>
              <span className={styles.finishMarker} aria-hidden="true">
                {hasNextSessionMaterial ? '✓' : canReviewClinical ? '3' : '2'}
              </span>
              <span className={styles.finishCopy}>
                <strong>Next session</strong>
                <small>
                  {hasNextSessionMaterial
                    ? 'At least one next step is saved'
                    : 'Add only what you agreed'}
                </small>
              </span>
              <span
                className={`${styles.statusTag} ${hasNextSessionMaterial ? styles.statusDone : styles.statusOptional}`}
              >
                {hasNextSessionMaterial ? 'Prepared' : 'Optional'}
              </span>
            </li>
          </ol>

          <div className={styles.finishLinks}>
            {!signed && (
              <Link href="#mind-note-review" className={styles.finishLink}>
                {noteReady || reopened ? 'Review the note' : 'Open note status'}
              </Link>
            )}
            {canReviewClinical && (
              <Link
                href={`/app/sessions/${sessionId}?tab=note&support=clinical#session-support`}
                className={styles.finishLink}
              >
                Review clinical support
              </Link>
            )}
            <Link href="#session-next-steps" className={styles.finishLink}>
              Add an optional next step
            </Link>
          </div>

          <p className={styles.signingBoundary}>
            Review any safety alert shown with the note before signing. Signing saves the clinical
            record; sharing is always a separate choice.
          </p>
          {signed && (
            <Link href="/app/today" className={styles.returnLink}>
              Return to Today
            </Link>
          )}
        </aside>
      </div>

      <section className={styles.optionalSteps} id="session-next-steps">
        <div className={styles.optionalStepsHeading}>
          <div>
            <h2 className={styles.finishTitle}>Optional next steps</h2>
            <p className={styles.finishIntro}>
              Save only what you and the client chose. Leaving an option untouched records no
              clinical decision and does not block signing.
            </p>
          </div>
          <span className={styles.optionalLabel}>Open one at a time</span>
        </div>
        <p className={styles.finishIntro}>
          {agreementCount} {agreementCount === 1 ? 'agreement' : 'agreements'} and{' '}
          {selectedQuestionCount}{' '}
          {selectedQuestionCount === 1 ? 'next-session question' : 'next-session questions'} saved
          from this session.
        </p>
        {decisionActions ?? (
          <MindCloseoutDecisionActions
            key={sessionId}
            sessionId={sessionId}
            steps={closeout.steps}
            canShare={canShare}
            clinicalReview={clinicalReview}
            canReviewClinical={canReviewClinical}
            canRecordWork={canRecordWork}
            initialReviewOpen={initialReviewOpen}
            agreementCount={agreementCount}
            appointmentScheduled={!!followUpSession}
            work={
              canRecordWork && (
                <>
                  <MindCareRecordPanel
                    key={`session-work-${sessionId}`}
                    clientId={client.id}
                    sessionContext={{ sessionId, scheduledAt: sessionAt.toISOString() }}
                    embedded
                  />
                  <div className="mt-5">
                    <MindWorkHistory key={`work-history-${client.id}`} clientId={client.id} />
                  </div>
                </>
              )
            }
            agreements={
              <MindSessionAgreements
                key={sessionId}
                sessionId={sessionId}
                signed={signed}
                hasSignedNote={hasSignedNote}
              />
            }
            appointment={
              <>
                <p className="mb-4">
                  If another appointment is useful, choose a time to suit your care plan. The form
                  starts one week later; nothing is booked until you save it.
                </p>
                <ScheduleSessionPanel
                  clients={[client]}
                  initialClientId={client.id}
                  initialDate={suggestedFollowUp.date}
                  initialTime={suggestedFollowUp.time}
                  closeoutMode
                  sourceSessionId={sessionId}
                  followUpState={closeout.steps.followUp}
                  followUpSession={followUpSession}
                  canSkipFollowUp={canReviewClinical}
                />
              </>
            }
          />
        )}
        {canShare && (
          <p className={`${styles.finishIntro} mt-5`}>
            {closeout.steps.shared === 'SKIPPED'
              ? 'You chose not to share from this session.'
              : closeout.steps.shared === 'COMPLETE'
                ? 'Sharing is recorded. Check the receipts below for each link or message and whether it was opened.'
                : 'After signing, use the note’s share action to preview what the client will receive.'}{' '}
            Copying a note does not sign or send it. Creating a link does not confirm delivery.
          </p>
        )}
      </section>
      {canShare && receipts.length > 0 && (
        <details className={styles.disclosure}>
          <summary>Sharing receipts ({receipts.length})</summary>
          <p className="px-5 pt-4 text-sm text-[var(--color-ink-2)]">
            Saved links, sending attempts and opened records are shown separately. A sent message is
            not confirmation that the client read it.
          </p>
          <ShareReceiptList receipts={receipts} />
          <p className="px-5 pb-5 text-sm">
            <Link
              href={`/app/clients/${client.id}/shared`}
              className="text-[var(--color-accent)] hover:underline"
            >
              View the client’s sharing history
            </Link>
          </p>
        </details>
      )}
    </section>
  );
}
