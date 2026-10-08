import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { DoctorEncounterPanel } from '@/components/app/DoctorEncounterPanel';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { isScribeTeleconsultEnabled } from '@/lib/scribe-teleconsult-links';
import { scribeAmbientCaptureDeclined } from '@/lib/scribe-consent-mode';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV3 — the doctor encounter workspace. Record → medical note on
 * the existing batch pipeline (DoctorEncounterPanel drives the loop).
 * Doctor-guarded + ownership-checked; isolated from the therapy session
 * workspace. See docs/DOCTOR_VERTICAL.md.
 */
export default async function EncounterWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ mode?: string; liveConsent?: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  const { id: clientId, sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      captureMode: true,
      consentSnapshot: true,
      psychologistId: true,
      clientId: true,
      client: { select: { fullNameEncrypted: true } },
    },
  });
  if (!session || session.psychologistId !== doctor.id || session.clientId !== clientId) {
    notFound();
  }
  if (session.status === 'IN_PROGRESS' && session.captureMode === 'LIVE') {
    redirect(`/app/patients/${clientId}/encounters/${sessionId}/live`);
  }
  const clientFullName = await decryptClientField(
    session.psychologistId,
    session.client.fullNameEncrypted,
  );

  const query = await searchParams;
  const resolvedMode =
    session.status === 'IN_PROGRESS'
      ? session.captureMode === 'UPLOAD'
        ? 'upload'
        : 'dictate'
      : query.mode === 'upload'
        ? 'upload'
        : 'dictate';

  return (
    <Container className="py-10">
      <Link
        href={`/app/patients/${clientId}`}
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← {clientFullName}
      </Link>
      <header className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Encounter</h1>
        <div className="flex items-center gap-3">
          {isScribeTeleconsultEnabled() && session.status === 'SCHEDULED' && (
            <Link
              href={`/app/patients/${clientId}/encounters/${sessionId}/teleconsult`}
              className="text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              Video consultation
            </Link>
          )}
          {session.status === 'SCHEDULED' && (
            <Link
              href={`/app/patients/${clientId}/encounters/${sessionId}/live?flash=1`}
              className="text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              ● Switch to live consult
            </Link>
          )}
          <Badge tone={session.status === 'COMPLETED' ? 'accent' : 'muted'}>
            {session.status.toLowerCase()}
          </Badge>
        </div>
      </header>
      <DoctorEncounterPanel
        key={`${session.id}:${resolvedMode}`}
        mode={resolvedMode}
        liveConsentDeclined={scribeAmbientCaptureDeclined(session.consentSnapshot)}
        sessionId={session.id}
        clientId={clientId}
        clientName={clientFullName}
        sessionStatus={session.status}
      />
    </Container>
  );
}
