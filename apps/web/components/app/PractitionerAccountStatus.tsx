import type { PsychologistStatus } from '@prisma/client';
import { ScribeLogo } from '@/components/ui/ScribeLogo';
import { practitionerAccountStatusCopy } from '@/lib/practitioner-account-status';

export function PractitionerAccountStatus({
  status,
  vertical,
  email,
  canSubmitRegistration = false,
}: {
  status: PsychologistStatus;
  vertical: 'DOCTOR' | 'THERAPIST';
  email: string;
  canSubmitRegistration?: boolean;
}) {
  const copy = practitionerAccountStatusCopy(status);
  const productName = vertical === 'DOCTOR' ? 'Cureocity Scribe' : 'Cureocity Mind';
  const supportHref = `mailto:shamil@cureo.city?subject=${encodeURIComponent(`${productName} account access`)}`;
  const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4';

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-xl">
        {vertical === 'DOCTOR' ? (
          <ScribeLogo href="/" />
        ) : (
          <a
            href="/"
            className={`inline-flex min-h-11 items-center rounded-lg font-serif text-xl ${focus}`}
          >
            Cureocity Mind
          </a>
        )}
        <section
          aria-labelledby="account-status-title"
          className="mt-10 rounded-2xl border border-[var(--color-line)] bg-white p-6 sm:p-8"
        >
          <h1
            id="account-status-title"
            className="font-serif text-3xl leading-tight text-[var(--color-ink)]"
          >
            {copy.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-ink-2)]">
            {copy.description}
          </p>
          <p className="mt-5 break-words text-sm text-[var(--color-ink-2)]">
            Signed in as <strong className="font-medium text-[var(--color-ink)]">{email}</strong>
          </p>
          <div className="mt-6 border-t border-[var(--color-line)] pt-6">
            <h2 className="text-base font-semibold">What to do next</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
              {copy.nextStep}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
              Account approval is separate from billing and your trial allowance. You do not need to
              make another payment to resolve this message.
            </p>
          </div>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            {canSubmitRegistration && (
              <a
                href="/onboarding"
                className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--color-line)] px-5 py-3 text-sm font-medium ${focus}`}
              >
                Submit registration details
              </a>
            )}
            {/* A full navigation rechecks current database status, including
                approval made while this page was open. No clinical API call. */}
            <a
              href="/account-status"
              className={`inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-white ${focus}`}
            >
              Check again
            </a>
            <a
              href={supportHref}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--color-line)] px-5 py-3 text-sm font-medium ${focus}`}
            >
              Contact support
            </a>
          </div>
        </section>
        <form method="POST" action="/api/v1/auth/signout" className="mt-5">
          <button
            type="submit"
            className={`min-h-11 rounded-lg px-2 text-sm underline underline-offset-4 ${focus}`}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
