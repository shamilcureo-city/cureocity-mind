import Link from 'next/link';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { ScheduleSessionPanel } from './ScheduleSessionPanel';
import { MindCloseoutDecisionActions } from './MindCloseoutDecisionActions';
import { suggestFollowUp } from '../../lib/follow-up-suggestion';

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
  children: React.ReactNode;
}

const labels: Record<keyof MindSessionCloseout['steps'], string> = {
  noteGenerated: 'Note generated',
  noteReviewed: 'Note reviewed',
  clinicalSuggestions: 'Clinical suggestions resolved or skipped',
  agreements: 'Agreements or homework captured or skipped',
  nextSessionQuestions: 'Next-session questions selected or skipped',
  signed: 'Note signed',
  shared: 'Shared or intentionally not shared',
  followUp: 'Follow-up scheduled or intentionally skipped',
};

export function MindSessionCloseout({
  sessionId,
  closeout,
  client,
  sessionAt,
  sessionCompleted,
  children,
}: Props) {
  if (!sessionCompleted) return <>{children}</>;
  const suggestedFollowUp = suggestFollowUp(sessionAt);
  return (
    <section className="space-y-6" aria-labelledby="mind-closeout-title">
      <Card className="border-t-[3px] border-t-[var(--color-accent)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
              Mind session completion
            </p>
            <h2 id="mind-closeout-title" className="mt-1 font-serif text-2xl">
              Review &amp; Close
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-2)]">
              Review the note once, resolve or deliberately skip each care decision, then sign and
              choose what happens next.
            </p>
          </div>
          <Link
            href={`/app/sessions/${sessionId}`}
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Open full session record →
          </Link>
        </div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-2">
          {Object.entries(closeout.steps).map(([key, state]) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line-soft)] px-3 py-2 text-sm"
            >
              <span aria-hidden="true">
                {state === 'COMPLETE' ? '✓' : state === 'SKIPPED' ? '–' : '○'}
              </span>
              <span>{labels[key as keyof MindSessionCloseout['steps']]}</span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                {state.toLowerCase()}
              </span>
            </li>
          ))}
        </ol>
        <MindCloseoutDecisionActions sessionId={sessionId} steps={closeout.steps} />
      </Card>
      {children}
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
          Follow-up
        </p>
        <h3 className="mt-1 font-serif text-xl">Schedule what happens next</h3>
        <p className="mb-4 mt-1 text-sm text-[var(--color-ink-2)]">
          We suggested one week at the same time. You can edit it or explicitly skip this step.
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
      </Card>
    </section>
  );
}
