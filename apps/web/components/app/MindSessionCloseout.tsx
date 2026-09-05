import Link from 'next/link';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { ScheduleSessionPanel } from './ScheduleSessionPanel';
import { MindCloseoutDecisionActions } from './MindCloseoutDecisionActions';
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
  sessionCompleted: boolean;
  canShare: boolean;
  agreementCount?: number;
  selectedQuestionCount?: number;
  receipts: ShareReceiptView[];
  children: React.ReactNode;
}

export function MindSessionCloseout({
  sessionId,
  closeout,
  client,
  sessionAt,
  sessionCompleted,
  canShare,
  agreementCount = 0,
  selectedQuestionCount = 0,
  receipts,
  children,
}: Props) {
  if (!sessionCompleted) return <>{children}</>;
  const suggestedFollowUp = suggestFollowUp(sessionAt);
  const signed = closeout.steps.signed === 'COMPLETE';
  const complete = Object.entries(closeout.steps)
    .filter(([key]) => canShare || key !== 'shared')
    .every(([, state]) => state !== 'PENDING');
  return (
    <section className="space-y-6" aria-labelledby="mind-closeout-title">
      <div className={styles.noteLead}>
        <div>
          <h2 id="mind-closeout-title">Review &amp; Close</h2>
          <p>
            {signed
              ? 'Your signed note is saved. Its signature does not send anything to the client.'
              : 'Make the note yours, sign when it is accurate, then choose the next steps below.'}
          </p>
        </div>
        <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
          Consult the clinical context
        </Link>
      </div>
      {children}
      <div className={styles.finish} id="session-next-steps">
        <h2 className={styles.finishTitle}>
          {complete ? 'Ready for the next chapter.' : 'What should happen next?'}
        </h2>
        <p className={styles.finishIntro}>
          {complete
            ? 'The note is signed and your next-step decisions are saved. You can return to Today.'
            : 'Keep what matters from this session. Choose an action when it is useful, or record that it is not needed today.'}
        </p>
        <div className={styles.evidence} aria-label="Saved session decisions">
          <span>{signed ? 'Note signed' : 'Signature pending'}</span>
          <span>
            {agreementCount} {agreementCount === 1 ? 'agreement saved' : 'agreements saved'}
          </span>
          <span>
            {selectedQuestionCount}{' '}
            {selectedQuestionCount === 1 ? 'question selected' : 'questions selected'} from this
            session
          </span>
        </div>
        <div className={styles.finishGrid}>
          <section className={styles.finishSection} aria-labelledby="care-decisions-title">
            <h3 id="care-decisions-title">Carry the care forward</h3>
            <p>Clinical suggestions stay separate from your decisions until you review them.</p>
            <MindCloseoutDecisionActions
              sessionId={sessionId}
              steps={closeout.steps}
              canShare={canShare}
            />
          </section>
          <section className={styles.finishSection} aria-labelledby="follow-up-title">
            <h3 id="follow-up-title">The next appointment</h3>
            <p className="mb-4">
              One week at the same time is suggested. Change it to suit your care plan, or record
              that a follow-up is not needed.
            </p>
            <ScheduleSessionPanel
              clients={[client]}
              initialClientId={client.id}
              initialDate={suggestedFollowUp.date}
              initialTime={suggestedFollowUp.time}
              closeoutMode
              sourceSessionId={sessionId}
              followUpState={closeout.steps.followUp}
            />
          </section>
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
        {complete && (
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
