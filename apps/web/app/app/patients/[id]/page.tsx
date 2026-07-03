import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StartEncounterButton } from '@/components/app/StartEncounterButton';
import { ChronicCarePanel } from '@/components/app/ChronicCarePanel';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV2 — doctor patient detail. Patient identity + an encounters
 * list + "Start encounter". Deliberately minimal: the recording surface
 * and the live medical note land in DV3/DV4, so encounters are listed
 * but not yet deep-linked into a workspace. See docs/DOCTOR_VERTICAL.md.
 */
export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const doctor = await requireOnboardedDoctor();
  const { id } = await params;

  const patient = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      fullNameEncrypted: true,
      contactPhone: true,
      contactPhoneEncrypted: true,
      contactEmail: true,
      contactEmailEncrypted: true,
      dateOfBirth: true,
      status: true,
      isDemo: true,
      createdAt: true,
      psychologistId: true,
      deletedAt: true,
      sessions: {
        orderBy: { scheduledAt: 'desc' },
        take: 50,
        select: { id: true, status: true, scheduledAt: true, createdAt: true },
      },
    },
  });

  if (!patient || patient.deletedAt !== null || patient.psychologistId !== doctor.id) {
    notFound();
  }
  // PII read cutover — prefer the encrypted columns (plaintext fallback).
  const pii = await resolveClientPii(patient);

  return (
    <Container className="py-10">
      <Link
        href="/app/patients"
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Patients
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 font-serif text-3xl">
            {pii.fullName}
            {patient.isDemo && <Badge tone="warn">Example</Badge>}
            <Badge tone={patient.status === 'ACTIVE' ? 'accent' : 'muted'}>
              {patient.status.toLowerCase()}
            </Badge>
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            {pii.contactPhone}
            {pii.contactEmail ? ` · ${pii.contactEmail}` : ''}
            {patient.dateOfBirth ? ` · DOB ${formatDate(patient.dateOfBirth)}` : ''}
          </p>
        </div>
        <StartEncounterButton clientId={patient.id} />
      </header>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Encounters
        </h2>
        <Card className="overflow-hidden">
          {patient.sessions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
              No encounters yet — “Start encounter” to record one.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {patient.sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/patients/${patient.id}/encounters/${s.id}`}
                    className="flex items-center justify-between px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                  >
                    <span className="text-[var(--color-ink)]">{formatDateTime(s.scheduledAt)}</span>
                    <Badge tone={s.status === 'COMPLETED' ? 'accent' : 'muted'}>
                      {s.status.toLowerCase()}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <ChronicCarePanel clientId={patient.id} />
    </Container>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
