import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';

export interface MindClientRosterRow {
  id: string;
  name: string;
  status: string;
  isDemo?: boolean;
  clientSinceLabel: string;
  totalRecords: number;
  lastCompletedLabel: string;
  nextAppointmentLabel: string;
  /** Presentation is safe to preview with a local anchor and disabled action. */
  href?: string;
  action?: ReactNode;
}

/** No data access, recording or mutation controls. The authorized page supplies row actions. */
export function MindClientRosterRows({ rows }: { rows: readonly MindClientRosterRow[] }) {
  return (
    <>
      <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-[var(--color-line-soft)] px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)] md:grid">
        <span>Name</span>
        <span>Status</span>
        <span>Client since</span>
        <span className="text-right tabular-nums">Appointment / session records</span>
        <span>Last completed / next</span>
      </div>
      <ul className="divide-y divide-[var(--color-line-soft)]">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center transition-colors hover:bg-[var(--color-surface-soft)]"
          >
            <Link
              href={row.href ?? `/app/clients/${row.id}`}
              className="grid min-w-0 flex-1 grid-cols-2 items-center gap-3 px-5 py-4 text-sm md:grid-cols-[2fr_1fr_1fr_1fr_1.5fr]"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2 break-words font-medium text-[var(--color-ink)]">
                {row.name || (
                  <span className="italic text-[var(--color-ink-3)]">Name unavailable</span>
                )}
                {!row.name && <Badge tone="warn">Name needs support</Badge>}
                {row.isDemo && <Badge tone="warn">Example</Badge>}
              </span>
              <span>
                <Badge tone={row.status === 'ACTIVE' ? 'accent' : 'muted'}>
                  {row.status.toLowerCase()}
                </Badge>
              </span>
              <span className="text-[var(--color-ink-2)]">
                <span className="md:hidden">Client since </span>
                {row.clientSinceLabel}
              </span>
              <span className="tabular-nums text-[var(--color-ink-2)] md:text-right">
                {row.totalRecords}
                <span className="md:hidden"> appointment / session records</span>
              </span>
              <span className="col-span-2 text-[var(--color-ink-2)] md:col-span-1">
                <span className="block">Last: {row.lastCompletedLabel}</span>
                <span className="mt-1 block text-xs text-[var(--color-ink-3)]">
                  Next: {row.nextAppointmentLabel}
                </span>
              </span>
            </Link>
            {row.action && <div className="shrink-0 pr-4">{row.action}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
