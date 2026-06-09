import Link from 'next/link';
import type { SessionKind, TherapyNoteV1 } from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { ClinicalBriefTab } from '@/components/app/ClinicalBriefTab';
import { InitialAssessmentTab } from '@/components/app/InitialAssessmentTab';
import { MindmapTab } from '@/components/app/MindmapTab';
import { ReflectionTab } from '@/components/app/ReflectionTab';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';
import { prisma } from '@/lib/prisma';

interface Props {
  sessionId: string;
  clientId: string;
  sessionKind: SessionKind;
}

/**
 * Sprint 27 — the session AI Copilot tab is now strictly
 * **per-session** ("this recording"): the clinical analysis of
 * this session plus the mindmap + reflection questions derived from
 * its note. The cross-session decision-support (case briefing,
 * conceptual map, diagnosis history, therapy library, workflow)
 * moved to the *client* AI Copilot, where it belongs — see
 * `ClientAICopilotTab`. A cross-link at the top points there so
 * the briefing is one click away mid-session.
 *
 * INTAKE sessions render the Initial Assessment Brief; TREATMENT /
 * REVIEW render the Clinical Brief + Mindmap + Reflection (the
 * latter two are SOAP-shaped and don't apply to intake).
 */
export async function AICopilotTab({ sessionId, clientId, sessionKind }: Props) {
  const isIntake = sessionKind === 'INTAKE';
  const [reportRow, draft, signed] = await Promise.all([
    prisma.clinicalReport.findUnique({ where: { sessionId } }),
    prisma.noteDraft.findUnique({ where: { sessionId }, select: { content: true } }),
    prisma.therapyNote.findUnique({ where: { sessionId }, select: { content: true } }),
  ]);
  const noteJson = (signed?.content ?? draft?.content) as TherapyNoteV1 | null;

  return (
    <div className="space-y-8">
      <ClientCopilotLink clientId={clientId} />

      {isIntake ? (
        <InitialAssessmentTab
          sessionId={sessionId}
          clientId={clientId}
          reportEnvelope={
            reportRow ? { status: reportRow.status, errorMessage: reportRow.errorMessage } : null
          }
          initialBrief={reportRow ? readInitialAssessmentBrief(reportRow) : null}
        />
      ) : (
        <>
          <ClinicalBriefTab
            sessionId={sessionId}
            initialReport={reportRow ? toClinicalReport(reportRow) : null}
          />
          {noteJson && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                Mindmap
              </h3>
              <MindmapTab note={noteJson} />
            </section>
          )}
          {noteJson && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                Reflection questions
              </h3>
              <ReflectionTab sessionId={sessionId} clientId={clientId} note={noteJson} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ClientCopilotLink({ clientId }: { clientId: string }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
      <p className="text-sm text-[var(--color-ink-2)]">
        Looking for the case briefing, diagnosis history, conceptual map or therapy library? Those
        live in this client&rsquo;s AI Copilot.
      </p>
      <Link
        href={`/app/clients/${clientId}?tab=copilot`}
        className="shrink-0 text-sm font-medium text-[var(--color-accent)] hover:underline"
      >
        Open client AI Copilot →
      </Link>
    </Card>
  );
}
