import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { StartEncounterButton } from '@/components/app/StartEncounterButton';
import { ChronicCarePanel } from '@/components/app/ChronicCarePanel';
import { ClientEditPanel } from '@/components/app/ClientEditPanel';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { SendCheckinButton } from '@/components/app/SendCheckinButton';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { getEffectiveCapabilities } from '@/lib/capabilities';
import { prisma } from '@/lib/prisma';
import { patientEncounterHref, resolvePatientWorkspaceMode } from '@/lib/patient-workspace';

export const dynamic = 'force-dynamic';

const WORKSPACE_SECTIONS = [
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['care', 'Care'],
  ['measures', 'Measures'],
  ['shares', 'Shares'],
] as const;

/** ORBIT Sprint 6 — one longitudinal Patient workspace for every practitioner. */
export default async function PatientWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const practitioner = await requireOnboardedPsychologist();
  const { id } = await params;

  const [patient, effective] = await Promise.all([
    prisma.client.findFirst({
      where: { id, psychologistId: practitioner.id, deletedAt: null },
      include: {
        sessions: {
          orderBy: { scheduledAt: 'desc' },
          take: 50,
          select: {
            id: true,
            kind: true,
            modality: true,
            status: true,
            scheduledAt: true,
            therapyNote: { select: { id: true } },
            noteDraft: { select: { status: true } },
            medicationOrders: { select: { id: true } },
            clinicalOrders: { select: { id: true } },
          },
        },
        treatmentPlans: {
          where: { supersededAt: null },
          take: 1,
          orderBy: { confirmedAt: 'desc' },
          select: { id: true, version: true, confirmedAt: true },
        },
        safetyPlans: {
          where: { supersededAt: null },
          take: 1,
          orderBy: { confirmedAt: 'desc' },
          select: { id: true, confirmedAt: true },
        },
        instrumentResponses: {
          orderBy: { administeredAt: 'desc' },
          take: 8,
          select: {
            id: true,
            instrumentKey: true,
            score: true,
            severity: true,
            administeredAt: true,
          },
        },
        patientShares: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, subject: true, channel: true, status: true, createdAt: true },
        },
      },
    }),
    getEffectiveCapabilities(practitioner.id),
  ]);
  if (!patient) notFound();

  const mode = resolvePatientWorkspaceMode([...effective.capabilities]);
  const { behavioral, medical } = mode;
  const age = patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : null;
  const orderCount = patient.sessions.reduce(
    (total, encounter) =>
      total + encounter.medicationOrders.length + encounter.clinicalOrders.length,
    0,
  );

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
            {patient.fullName}
            {patient.isDemo && <Badge tone="warn">Example</Badge>}
            <Badge tone={patient.status === 'ACTIVE' ? 'accent' : 'muted'}>
              {patient.status.toLowerCase()}
            </Badge>
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            {age === null ? 'Age not recorded' : `${age} years`}
            {' · '}Patient since {formatMonth(patient.createdAt)}
            {patient.preferredLanguage ? ` · ${patient.preferredLanguage.toUpperCase()}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SendCheckinButton
            clientId={patient.id}
            hasContactPhone={Boolean(patient.contactPhone)}
            hasContactEmail={Boolean(patient.contactEmail)}
          />
          <ClientEditPanel client={editablePatient(patient)} />
          {medical && !behavioral ? (
            <StartEncounterButton clientId={patient.id} />
          ) : (
            <ButtonLink href="/app/encounters/new" variant="primary" size="sm">
              + New encounter
            </ButtonLink>
          )}
        </div>
      </header>

      <nav
        className="mt-7 overflow-x-auto border-b border-[var(--color-line-soft)]"
        aria-label="Patient workspace"
      >
        <ul className="flex min-w-max gap-6">
          {WORKSPACE_SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="overview" className="scroll-mt-6 pt-7">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Overview
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <PatientField label="Phone" value={patient.contactPhone} mono />
              <PatientField label="Email" value={patient.contactEmail ?? 'Not recorded'} />
              <PatientField
                label="Date of birth"
                value={patient.dateOfBirth ? formatDate(patient.dateOfBirth) : 'Not recorded'}
              />
              <PatientField
                label="Spoken languages"
                value={
                  patient.spokenLanguages.length
                    ? patient.spokenLanguages.join(', ').toUpperCase()
                    : 'Not recorded'
                }
              />
            </dl>
            {patient.presentingConcerns && (
              <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
                <p className="text-xs text-[var(--color-ink-3)]">Presenting concerns</p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                  {patient.presentingConcerns}
                </p>
              </div>
            )}
          </Card>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <Metric label="Encounters" value={patient.sessions.length} />
            <Metric label="Measures" value={patient.instrumentResponses.length} />
            <Metric label="Orders" value={orderCount} />
          </div>
        </div>
      </section>

      <section id="timeline" className="scroll-mt-6 pt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Timeline
        </h2>
        <Card className="mt-3 overflow-hidden">
          {patient.sessions.length === 0 ? (
            <EmptyState>No encounters recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {patient.sessions.map((encounter) => (
                <li key={encounter.id}>
                  <Link
                    href={patientEncounterHref(patient.id, encounter.id, mode)}
                    className="grid gap-2 px-5 py-4 text-sm hover:bg-[var(--color-surface-soft)] sm:grid-cols-[1.4fr_1fr_1.4fr_auto]"
                  >
                    <span>{formatDateTime(encounter.scheduledAt)}</span>
                    <span className="text-[var(--color-ink-2)]">
                      {encounter.modality ?? encounter.kind.toLowerCase()}
                    </span>
                    <span className="text-[var(--color-ink-2)]">{documentSummary(encounter)}</span>
                    <Badge tone={encounter.status === 'COMPLETED' ? 'accent' : 'muted'}>
                      {encounter.status.toLowerCase()}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="care" className="scroll-mt-6 pt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Care
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {behavioral && (
            <CareCard
              title="Treatment plan"
              value={
                patient.treatmentPlans[0]
                  ? `Version ${patient.treatmentPlans[0].version} · confirmed ${formatDate(patient.treatmentPlans[0].confirmedAt)}`
                  : 'No active treatment plan'
              }
            />
          )}
          {behavioral && (
            <CareCard
              title="Safety plan"
              value={
                patient.safetyPlans[0]
                  ? `Active · confirmed ${formatDate(patient.safetyPlans[0].confirmedAt)}`
                  : 'No active safety plan'
              }
            />
          )}
          {medical && (
            <CareCard
              title="Clinical orders"
              value={`${orderCount} medication or clinical order${orderCount === 1 ? '' : 's'} across encounters`}
            />
          )}
        </div>
        {medical && <ChronicCarePanel clientId={patient.id} />}
      </section>

      <section id="measures" className="scroll-mt-6 pt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Measures
        </h2>
        <Card className="mt-3 overflow-hidden">
          {patient.instrumentResponses.length === 0 ? (
            <EmptyState>No measures recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {patient.instrumentResponses.map((measure) => (
                <li
                  key={measure.id}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-sm"
                >
                  <span>
                    <strong>{measure.instrumentKey}</strong>
                    <span className="ml-2 text-[var(--color-ink-3)]">
                      {formatDate(measure.administeredAt)}
                    </span>
                  </span>
                  <span>
                    {measure.score} · {measure.severity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="shares" className="scroll-mt-6 pt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Shares &amp; data rights
        </h2>
        <Card className="mt-3 overflow-hidden">
          {patient.patientShares.length === 0 ? (
            <EmptyState>No shared items yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {patient.patientShares.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-sm"
                >
                  <span>
                    {share.subject}
                    <span className="ml-2 text-[var(--color-ink-3)]">
                      {share.channel.toLowerCase()}
                    </span>
                  </span>
                  <Badge tone={share.status === 'SENT' ? 'accent' : 'muted'}>
                    {share.status.toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="mt-4">
          <DataRightsCard clientId={patient.id} clientName={patient.fullName} />
        </div>
      </section>
    </Container>
  );
}

function PatientField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-ink-3)]">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{value}</dd>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-[var(--color-ink-3)]">{label}</p>
    </Card>
  );
}
function CareCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="p-5">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">{value}</p>
    </Card>
  );
}
function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">{children}</p>;
}
function documentSummary(encounter: {
  therapyNote: { id: string } | null;
  noteDraft: { status: string } | null;
  medicationOrders: { id: string }[];
  clinicalOrders: { id: string }[];
}) {
  if (encounter.therapyNote) return 'Signed note';
  if (encounter.noteDraft?.status === 'COMPLETED') return 'Draft note';
  const orders = encounter.medicationOrders.length + encounter.clinicalOrders.length;
  return orders ? `${orders} order${orders === 1 ? '' : 's'}` : 'No document';
}
function editablePatient(patient: {
  id: string;
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
  dateOfBirth: Date | null;
  presentingConcerns: string | null;
  preferredLanguage: string;
  spokenLanguages: string[];
}) {
  return { ...patient, dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) ?? null };
}
function calculateAge(dob: Date) {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  )
    age -= 1;
  return age;
}
function formatMonth(date: Date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
function formatDate(date: Date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(date: Date) {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
