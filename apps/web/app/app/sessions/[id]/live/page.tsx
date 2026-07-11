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

  // Sprint TS5 — seed the live copilot: the questions the therapist carried in,
  // and whether prior suicidal ideation is on file (drives the deterministic
  // "re-check ideation" risk item). Both come over the wire — the gateway has
  // no DB. Defensive: a malformed carriedQuestions blob just seeds nothing.
  const carriedParse = z.array(CarriedQuestionSchema).safeParse(session.client.carriedQuestions);
  const carriedQuestions: TherapyCarriedQuestion[] = carriedParse.success
    ? carriedParse.data.map((q) => ({ question: q.question, why: q.rationale }))
    : [];
  const openCrises = await fetchOpenCrises(session.clientId);
  const priorRisk = openCrises.some(
    (c) => c.kind === 'suicidal_ideation' || c.kind === 'suicidal_plan',
  );

  return (
    <Container className="py-8">
      <TherapistLiveSession
        sessionId={session.id}
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
