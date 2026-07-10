import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  PatientShareSnapshotSchema,
  PatientShareTokenSchema,
  type PatientShareSnapshot,
} from '@cureocity/contracts';
import { hotlinesForCrisisKind } from '@cureocity/clinical';
import { CheckinForm } from '@/components/portal/CheckinForm';
import { HomeworkDoneButton } from '@/components/portal/HomeworkDoneButton';
import { writeAudit } from '@/lib/audit';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { WATERMARK_TAGLINE, watermarkUrl } from '@/lib/watermark';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// SHARE-2 — this page contains clinical PHI behind an unguessable token. Never
// let a search engine index it, and override the marketing <title> the root
// layout would otherwise leak into the browser tab / link previews with a
// neutral, non-disclosing one.
export const metadata: Metadata = {
  title: 'A private page for you',
  robots: { index: false, follow: false, nocache: true },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Sprint 15 — Public patient portal at /p/<token>.
 *
 * No auth. The token (16 random bytes → 22 base64url chars) IS the
 * authentication; ~128 bits of entropy is sufficient for an opaque
 * unguessable URL. The page renders the artefact snapshot in the
 * client's preferred language and records the open in the audit log.
 *
 * First view sets openedAt + writes PATIENT_PORTAL_OPENED; repeat
 * views write a fresh audit row but leave openedAt at the first
 * timestamp.
 *
 * Expired tokens render a friendly "link expired" message rather
 * than a generic 404 so the patient knows to ask their therapist
 * for a fresh link.
 */
export default async function PortalPage({ params }: PageProps) {
  const { token: raw } = await params;
  const tokenParse = PatientShareTokenSchema.safeParse(raw);
  if (!tokenParse.success) {
    notFound();
  }
  const token = tokenParse.data;

  const row = await prisma.patientShare.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      subject: true,
      snapshot: true,
      language: true,
      openedAt: true,
      expiresAt: true,
      status: true,
      client: { select: { fullNameEncrypted: true } },
      psychologist: { select: { fullName: true } },
    },
  });
  if (!row) notFound();
  // Read cutover — the share row carries psychologistId, so the portal can
  // decrypt the client's name for the greeting.
  const clientFullName = await decryptClientField(row.psychologistId, row.client.fullNameEncrypted);

  const now = new Date();
  const expired = row.expiresAt.getTime() < now.getTime();
  // SHARE-1 — a revoked link is dead: don't render the artefact and don't
  // audit an open. Folded into the same not-available gate as expiry.
  const revoked = row.status === 'REVOKED';
  const unavailable = expired || revoked;

  const snapshotParse = PatientShareSnapshotSchema.safeParse(row.snapshot);
  const snapshot: PatientShareSnapshot | null = snapshotParse.success ? snapshotParse.data : null;

  // Best-effort metadata from headers — same shape as auditMetadataFromRequest
  // but without access to NextRequest in the page component.
  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? undefined;
  const userAgent = hdrs.get('user-agent') ?? undefined;

  if (!unavailable) {
    // First open sets openedAt + flips status; later opens still audit.
    const isFirstOpen = row.openedAt === null;
    if (isFirstOpen) {
      await prisma.patientShare.update({
        where: { id: row.id },
        data: {
          openedAt: now,
          ...(row.status === 'SENT' ? { status: 'OPENED' } : {}),
        },
      });
    }
    await writeAudit({
      actorType: 'CLIENT',
      action: 'PATIENT_PORTAL_OPENED',
      targetType: 'PatientShare',
      targetId: row.id,
      metadata: {
        ...(ip !== undefined && { ip }),
        ...(userAgent !== undefined && { userAgent }),
        clientId: row.clientId,
        psychologistId: row.psychologistId,
        repeat: !isFirstOpen,
      },
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="border-b border-[var(--color-line-soft)] pb-5">
        <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          From {row.psychologist.fullName}
        </p>
        <h1 className="mt-1 font-serif text-2xl">{row.subject}</h1>
      </header>

      {unavailable ? (
        <section className="mt-8 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-2)]">
          <p className="font-medium text-[var(--color-ink)]">
            {revoked ? 'This link is no longer available.' : 'This link has expired.'}
          </p>
          <p className="mt-2">Ask {row.psychologist.fullName} to share a fresh link with you.</p>
        </section>
      ) : snapshot ? (
        <section className="mt-8">
          <SnapshotView
            snapshot={snapshot}
            clientFirstName={firstName(clientFullName)}
            token={token}
          />
        </section>
      ) : (
        <section className="mt-8 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-2)]">
          <p>This page could not be rendered. Ask your therapist to share it again.</p>
        </section>
      )}

      <footer className="mt-10 border-t border-[var(--color-line-soft)] pt-5 text-xs text-[var(--color-ink-3)]">
        <p>This page is private to you. Cureocity Mind does not share it with anyone else.</p>
        <p className="mt-3">
          <a
            href={watermarkUrl({
              source: 'patient_portal',
              campaign: snapshot?.kind ?? 'PORTAL',
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-accent)] hover:underline"
          >
            {WATERMARK_TAGLINE}
          </a>
        </p>
      </footer>
    </main>
  );
}

function SnapshotView({
  snapshot,
  clientFirstName,
  token,
}: {
  snapshot: PatientShareSnapshot;
  clientFirstName: string;
  token: string;
}) {
  switch (snapshot.kind) {
    case 'SIGNED_NOTE':
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, here is the note from our session.
          </p>
          <NoteSection title="What you shared" body={snapshot.subjective} />
          <NoteSection title="What I observed" body={snapshot.objective} />
          <NoteSection title="My thinking" body={snapshot.assessment} />
          <NoteSection title="What we'll work on" body={snapshot.plan} />
          {snapshot.pdfUrl && (
            <p className="text-sm">
              <a
                href={snapshot.pdfUrl}
                className="text-[var(--color-accent)] underline"
                rel="noopener"
              >
                Download a PDF of this note
              </a>
            </p>
          )}
        </article>
      );
    case 'REFLECTION_QUESTIONS':
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, sit with these between now and our next session. No need to write
            essays — short, honest notes are enough.
          </p>
          <ol className="space-y-3">
            {snapshot.questions.map((q, i) => (
              <li
                key={i}
                className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
              >
                <p className="text-sm leading-relaxed text-[var(--color-ink)]">
                  <strong className="mr-2 text-[var(--color-ink-2)]">{i + 1}.</strong>
                  {q}
                </p>
              </li>
            ))}
          </ol>
        </article>
      );
    case 'THERAPY_SCRIPT':
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, here's a summary of the technique we worked on:{' '}
            <strong>{snapshot.therapyName}</strong>.
          </p>
          <section className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              In session
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
              {snapshot.patientSummary}
            </p>
          </section>
          <section className="rounded-xl border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-accent)]">
              Between sessions
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink)]">{snapshot.homework.description}</p>
            <p className="mt-2 text-xs italic text-[var(--color-ink-3)]">
              {snapshot.homework.deliveryNotes}
            </p>
            {/* Sprint 51 — homework loop. The button appears only when
                the share was sent with assignHomework=true (assignment
                id present) and not yet marked done. */}
            {snapshot.homeworkAssignmentId && !snapshot.homeworkCompleted && (
              <HomeworkDoneButton token={token} />
            )}
            {snapshot.homeworkCompleted && (
              <p className="mt-3 rounded-xl bg-white/40 p-3 text-sm text-[var(--color-ink-2)]">
                Marked done
                {snapshot.homeworkCompletedAt && (
                  <>
                    {' '}
                    on{' '}
                    {new Date(snapshot.homeworkCompletedAt).toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </>
                )}
                . Your therapist will see it before your next session.
              </p>
            )}
          </section>
        </article>
      );
    case 'TREATMENT_PLAN':
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, here's the plan we're working towards together.
          </p>
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Approach
              </dt>
              <dd className="mt-1 capitalize text-[var(--color-ink)]">{snapshot.modality}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Expected sessions
              </dt>
              <dd className="mt-1 text-[var(--color-ink)]">
                {snapshot.expectedDurationSessions ?? 'we will reassess as we go'}
              </dd>
            </div>
          </dl>
          <section>
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Phases we'll move through
            </h2>
            <ol className="mt-2 flex flex-wrap gap-2 text-sm">
              {snapshot.phaseSequence.map((p, i) => (
                <li
                  key={i}
                  className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[var(--color-ink-2)]"
                >
                  {i + 1}. {p}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Goals</h2>
            <ul className="mt-2 space-y-3">
              {snapshot.goals.map((g, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
                >
                  <p className="text-sm font-medium text-[var(--color-ink)]">{g.description}</p>
                  <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                    how we'll know: {g.measure}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </article>
      );
    case 'PROGRESS_REPORT':
      return (
        <article className="space-y-6">
          <p className="text-sm text-[var(--color-ink-2)]">Hi {clientFirstName},</p>
          <section className="rounded-2xl bg-[var(--color-accent-soft)] p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
              Your progress
            </p>
            <p className="mt-2 font-serif text-2xl leading-snug text-[var(--color-ink)]">
              {snapshot.headline}
            </p>
            {(snapshot.sessionsCompleted > 0 || snapshot.startedAt) && (
              <p className="mt-3 text-sm text-[var(--color-ink-2)]">
                {snapshot.sessionsCompleted} session
                {snapshot.sessionsCompleted === 1 ? '' : 's'} since{' '}
                {formatStartedAt(snapshot.startedAt)}.
              </p>
            )}
          </section>
          {snapshot.intro && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
              {snapshot.intro}
            </p>
          )}
          {snapshot.focusSummary && (
            <p className="text-sm leading-relaxed text-[var(--color-ink)]">
              {snapshot.focusSummary}
            </p>
          )}
          <section className="space-y-4">
            {snapshot.instruments.map((entry) => (
              <ProgressInstrumentBar key={entry.label} entry={entry} />
            ))}
          </section>
          {snapshot.goals.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                What we are working on together
              </h2>
              <ul className="mt-2 space-y-2">
                {snapshot.goals.map((g, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 text-sm"
                  >
                    <p className="font-medium text-[var(--color-ink)]">{g.description}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                      how we will know: {g.measure}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              A few thoughts from your therapist
            </h2>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--color-ink)]">
              {snapshot.encouragements.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>
      );
    case 'INSTRUMENT_CHECKIN':
      if (snapshot.completed) {
        return (
          <article className="space-y-4">
            <div className="rounded-2xl bg-[var(--color-accent-soft)] p-6 text-center">
              <p className="font-serif text-xl text-[var(--color-ink)]">
                Thank you, {clientFirstName}.
              </p>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                Your check-in has been saved and sent to your therapist. There&apos;s nothing more
                to do here — they&apos;ll review it before your next session.
              </p>
            </div>
          </article>
        );
      }
      return (
        <CheckinForm
          token={token}
          clientFirstName={clientFirstName}
          recallWindow={snapshot.recallWindow}
          items={snapshot.items}
          scale={snapshot.scale}
          riskItemNumber={snapshot.riskItemNumber}
          crisisHotlines={hotlinesForCrisisKind('suicidal_ideation')}
        />
      );
    case 'SIGNED_INTAKE_NOTE':
      // Sprint 49 — patient-friendly subset of the intake note. Each
      // section is rendered as a titled block (the builder picked the
      // sections + their order).
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, here is a summary of our intake conversation.
          </p>
          {snapshot.sections.map((s, i) => (
            <NoteSection key={i} title={s.title} body={s.body} />
          ))}
          {snapshot.pdfUrl && (
            <p className="text-sm">
              <a
                href={snapshot.pdfUrl}
                className="text-[var(--color-accent)] underline"
                rel="noopener"
              >
                Download a PDF of this summary
              </a>
            </p>
          )}
        </article>
      );
    case 'AFTER_VISIT_SUMMARY':
      // Sprint DV3 — patient-facing recap of the doctor encounter. Each
      // non-empty list is rendered; red flags get a warning block.
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, {snapshot.greeting}
          </p>
          {snapshot.whatWeDiscussed.length > 0 && (
            <AvsList title="What we discussed" items={snapshot.whatWeDiscussed} />
          )}
          {snapshot.medications.length > 0 && (
            <AvsList title="Your medicines" items={snapshot.medications} />
          )}
          {snapshot.instructions.length > 0 && (
            <AvsList title="What to do" items={snapshot.instructions} />
          )}
          <NoteSection title="Follow-up" body={snapshot.followUp} />
          {snapshot.redFlags.length > 0 && (
            <section className="rounded-xl border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4">
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-warn)]">
                Come back sooner if
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink)]">
                {snapshot.redFlags.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}
        </article>
      );
    case 'CHRONIC_PROGRESS_REPORT':
      // Sprint DV7 — patient-facing chronic-disease control trajectory.
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, {snapshot.greeting}
          </p>
          <p className="font-serif text-xl text-[var(--color-ink)]">{snapshot.headline}</p>
          <ul className="space-y-2">
            {snapshot.measures.map((m, i) => (
              <li
                key={i}
                className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed text-[var(--color-ink)]"
              >
                {m}
              </li>
            ))}
          </ul>
          {snapshot.encouragement && (
            <p className="text-sm text-[var(--color-ink-2)]">{snapshot.encouragement}</p>
          )}
        </article>
      );
    case 'RX_PAD':
      // Sprint DS5-fu — patient-facing prescription (confirmed meds only).
      return (
        <article className="space-y-5">
          <p className="text-sm text-[var(--color-ink-2)]">
            Hi {clientFirstName}, {snapshot.greeting}
          </p>
          <NoteSection title="Diagnosis" body={snapshot.diagnosisLine} />
          {snapshot.medications.length > 0 && (
            <section className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
              <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Your medicines
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-[var(--color-ink)]">
                {snapshot.medications.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span>{m.line}</span>
                    {m.continued && (
                      <span className="rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-[11px] text-[var(--color-ink-3)]">
                        continued
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <AvsList title="Tests advised" items={snapshot.investigations} />
          <AvsList title="Advice" items={snapshot.advice} />
          <NoteSection title="Follow-up" body={snapshot.followUp} />
        </article>
      );
  }
}

function ProgressInstrumentBar({
  entry,
}: {
  entry: import('@cureocity/contracts').ProgressReportInstrumentEntry;
}) {
  const v = entry.change.verdict;
  const chipPalette =
    v === 'reliable_improvement'
      ? 'bg-[var(--color-accent)] text-white'
      : v === 'deterioration'
        ? 'bg-[var(--color-warn)] text-white'
        : 'bg-white text-[var(--color-ink-2)] border border-[var(--color-line)]';
  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--color-ink)]">{entry.label}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs ${chipPalette}`}>
          {entry.verdictChip}
        </span>
      </div>
      <p className="mt-2 text-base leading-relaxed text-[var(--color-ink)]">{entry.narrative}</p>
      <p className="mt-3 text-xs text-[var(--color-ink-3)]">
        Then <span className="font-mono">{entry.change.baselineScore}</span> · Now{' '}
        <span className="font-mono">{entry.change.latestScore}</span> ·{' '}
        {entry.change.administrationCount} check-in
        {entry.change.administrationCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return 'we began';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'we began';
  return then.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function AvsList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--color-ink)]">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </section>
  );
}

function NoteSection({ title, body }: { title: string; body: string }) {
  if (!body || body.trim().length === 0) return null;
  return (
    <section className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
        {body}
      </p>
    </section>
  );
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return 'there';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
