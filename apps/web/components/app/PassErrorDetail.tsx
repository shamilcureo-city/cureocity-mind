/**
 * The technical half of a pass failure, folded away.
 *
 * Kept reachable because it is what a support conversation needs, and hidden
 * by default because a serialised ZodError is not something to hand a
 * therapist between clients. Renders nothing when the message was already
 * readable — `describePassError` returns a null detail in that case.
 */
export function PassErrorDetail({ detail }: { detail: string | null }) {
  if (!detail) return null;
  return (
    <details className="mx-auto mt-4 max-w-md text-left">
      <summary className="cursor-pointer text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]">
        Technical details
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface-soft)] p-3 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
        {detail}
      </pre>
    </details>
  );
}
