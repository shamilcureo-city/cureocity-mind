import Link from 'next/link';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { ScheduleSessionPanel } from './ScheduleSessionPanel';
import { MindCloseoutDecisionActions } from './MindCloseoutDecisionActions';
import { MindSessionAgreements } from './MindSessionAgreements';
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
  initialReviewOpen?: boolean;
  hasSignedNote?: boolean;
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
  initialReviewOpen = false,
  hasSignedNote,
}: Props) {
  if (!sessionCompleted) return <>{children}</>;
  const suggestedFollowUp = suggestFollowUp(sessionAt);
  const signed = closeout.steps.signed === 'COMPLETE';
  return (
    <section className="space-y-6" aria-labelledby="mind-closeout-title">
      <div className={styles.noteLead}>
        <div>
          <h2 id="mind-closeout-title">Review &amp; finish</h2>
          <p>
            {signed
              ? 'Your signed note is saved. Its signature does not send anything to the client.'
              : 'Check the note against the session. Sign when it is accurate, or keep a saved unsigned draft to return to later.'}
          </p>
        </div>
        {canReviewClinical && (
          <Link href="#session-support" className={styles.contextLink}>
            Session support
          </Link>
        )}
      </div>
      {children}
      <MindCloseoutDecisionActions
        key={sessionId}
        sessionId={sessionId}
        steps={closeout.steps}
        canShare={canShare}
        clinicalReview={clinicalReview}
        canReviewClinical={canReviewClinical}
        initialReviewOpen={initialReviewOpen}
      />
      <div className={styles.finish} id="session-next-steps">
        <h2 className={styles.finishTitle}>Next steps, if useful</h2>
        <p className={styles.finishIntro}>
          There is no checklist to complete here. Save only what you and the client chose. Leaving
          an option untouched does not record a clinical decision or mark it completed.
        </p>
        <div className={styles.evidence} aria-label="Saved session decisions">
          <span>{signed ? 'Note signed' : 'Note not signed'}</span>
          <span>
            {agreementCount} {agreementCount === 1 ? 'agreement saved' : 'agreements saved'}
          </span>
          {canReviewClinical && (
            <span>
              {selectedQuestionCount}{' '}
              {selectedQuestionCount === 1 ? 'question selected' : 'questions selected'} from this
              session
            </span>
          )}
        </div>
        <div className="mt-5 space-y-3">
          <details className={styles.disclosure}>
            <summary>
              Agreements or homework{agreementCount > 0 ? ` (${agreementCount} saved)` : ''}
            </summary>
            <div className={styles.disclosureBody}>
              <MindSessionAgreements
                key={sessionId}
                sessionId={sessionId}
                signed={signed}
                hasSignedNote={hasSignedNote}
              />
            </div>
          </details>
          <details className={styles.disclosure}>
            <summary>The next appointment{followUpSession ? ' · scheduled' : ''}</summary>
            <div className={styles.disclosureBody}>
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
              />
            </div>
          </details>
        </div>
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
        {signed && (
          <p className="mt-5">
            <Link href="/app/today" className={styles.contextLink}>
              Return to Today
            </Link>
          </p>
        )}
      </div>
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
