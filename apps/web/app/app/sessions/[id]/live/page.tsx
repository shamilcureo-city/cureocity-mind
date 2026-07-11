import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { CarriedQuestionSchema, type TherapyCarriedQuestion } from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { TherapistLiveSession } from '@/components/app/TherapistLiveSession';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { fetchOpenCrises } from '@/lib/crisis-flags';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint TS2 — the therapist live scribe page. Streams the session to the
 * live gateway and shows the transcript + note building in real time, then
 * routes to the workspace for review + sign. Doctors use their own live
 * encounter route; a doctor landing here is redirected to their clinic.
 */
export default async function TherapistLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flash?: string }>;
}) {
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const { id } = await params;
  const sp = await searchParams;

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      kind: true,
      modality: true,
      language: true,
      status: true,
      client: { select: { fullNameEncrypted: true, carriedQuestions: true } },
    },
  });
  if (!session || session.psychologistId !== therapist.id) notFound();
  // A completed session has nothing left to record — send to the workspace.
  if (session.status === 'COMPLETED') redirect(`/app/sessions/${id}`);

  const clientName = await decryptClientField(therapist.id, session.client.fullNameEncrypted);

  // Sprint TS5 → TS5.4 — seed the live copilot's SESSION PLAN from the whole
  // record, not just the wrap-up blob: the questions the therapist explicitly
  // carried in (wrap-up) PLUS the copilot's open assessment questions (the
  // AssessmentItem rows the Journey ranks — the actual "what to ask" plan).
  // Ranked like the care engine (safety > differentiate > confirm > context,
  // oldest first), deduped, capped. Everything goes over the wire — the
  // gateway has no DB — and the browser renders the same plan instantly, so
  // the plan is visible even before the gateway says a word.
  const carriedParse = z.array(CarriedQuestionSchema).safeParse(session.client.carriedQuestions);
  const wrapUpCarried: TherapyCarriedQuestion[] = carriedParse.success
    ? carriedParse.data.map((q) => ({ question: q.question, why: q.rationale }))
    : [];

  const KIND_RANK: Record<string, number> = {
    SAFETY: 0,
    ASSESSMENT_GAP: 1,
    DIAGNOSTIC_CRITERION: 2,
    INSTRUMENT: 3,
  };
  const openItems = await prisma.assessmentItem.findMany({
    where: { clientId: session.clientId, status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    take: 40,
    select: { kind: true, question: true, rationale: true },
  });
  const rankedItems: TherapyCarriedQuestion[] = openItems
    .map((i, idx) => ({ i, idx }))
    .sort((a, b) => (KIND_RANK[a.i.kind] ?? 9) - (KIND_RANK[b.i.kind] ?? 9) || a.idx - b.idx)
    .map(({ i }) => ({
      question: i.question.slice(0, 500),
      why: i.rationale ? i.rationale.slice(0, 400) : null,
    }));

  // Wrap-up questions first (the therapist chose them), then the copilot's
  // ranked open questions; dedupe on normalised text; cap at the rail's size.
  const seen = new Set<string>();
  const carriedQuestions: TherapyCarriedQuestion[] = [];
  for (const q of [...wrapUpCarried, ...rankedItems]) {
    const key = q.question.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    carriedQuestions.push({
      question: q.question.slice(0, 500),
      why: q.why ? q.why.slice(0, 400) : null,
    });
    if (carriedQuestions.length >= 6) break;
  }

  const openCrises = await fetchOpenCrises(session.clientId);
  const priorRisk = openCrises.some(
    (c) => c.kind === 'suicidal_ideation' || c.kind === 'suicidal_plan',
  );

  return (
    <Container className="py-8">
      <TherapistLiveSession
        sessionId={session.id}
        clientId={session.clientId}
        kind={session.kind}
        modality={session.modality}
        language={session.language}
        clientName={clientName}
        autoStart={sp.flash === '1'}
        carriedQuestions={carriedQuestions}
        priorRisk={priorRisk}
      />
    </Container>
  );
}
