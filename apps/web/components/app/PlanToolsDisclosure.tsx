'use client';

import { useEffect, useState, type ReactNode } from 'react';

export function PlanToolsDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncFragment = () => {
      if (window.location.hash === '#poc-tools') setOpen(true);
    };
    syncFragment();
    window.addEventListener('hashchange', syncFragment);
    return () => window.removeEventListener('hashchange', syncFragment);
  }, []);

  return (
    <details
      id="poc-tools"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="scroll-mt-24 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 print:hidden"
    >
      {children}
    </details>
  );
}
