import Link from 'next/link';
import { ClientWorkspaceNav } from './ClientWorkspaceNav';

interface Props {
  clientId: string;
  clientName: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

export function ClientWorkspacePage({
  clientId,
  clientName,
  eyebrow,
  title,
  description,
  children,
}: Props) {
  return (
    <>
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app/clients" className="hover:text-[var(--color-ink)]">
          ← All clients
        </Link>
        <span aria-hidden> · </span>
        <Link href={`/app/clients/${clientId}`} className="hover:text-[var(--color-ink)]">
          {clientName}
        </Link>
      </p>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-serif text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-ink-2)]">{description}</p>
      </header>
      <div className="mt-5">
        <ClientWorkspaceNav clientId={clientId} />
      </div>
      <div className="mt-6">{children}</div>
    </>
  );
}
