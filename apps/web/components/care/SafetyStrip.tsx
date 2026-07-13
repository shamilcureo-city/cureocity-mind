export interface CareResource {
  name: string;
  number: string;
  hours: string;
}

/**
 * The persistent safety strip — chrome on EVERY authed /care screen, not
 * a dismissible banner (§2 layer 1). Server-rendered where possible.
 */
export function SafetyStrip({ resources }: { resources: CareResource[] }) {
  const primary = resources[0];
  const secondary = resources[1];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-warn)]/25 bg-[var(--color-warn-soft)] px-4 py-2 text-[13px] text-[#7c4322] md:left-64">
      <span className="font-semibold">In crisis?</span>{' '}
      {primary ? (
        <a className="underline underline-offset-2" href={`tel:${primary.number}`}>
          {primary.name} {primary.number}
        </a>
      ) : (
        <a className="underline underline-offset-2" href="tel:9152987821">
          iCall 9152987821
        </a>
      )}
      {secondary ? (
        <>
          {' · '}
          <a className="underline underline-offset-2" href={`tel:${secondary.number}`}>
            {secondary.name} {secondary.number}
          </a>
        </>
      ) : null}
      <span className="ml-1 opacity-80">— this app is not for emergencies.</span>
    </div>
  );
}
