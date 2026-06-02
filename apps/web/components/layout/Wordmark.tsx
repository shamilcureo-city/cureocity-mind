import Link from 'next/link';

export function Wordmark({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2 ${
        inverted ? 'text-white' : 'text-[var(--color-ink)]'
      }`}
    >
      <span
        aria-hidden
        className={`grid h-8 w-8 place-items-center rounded-full font-serif text-base ${
          inverted
            ? 'bg-white text-[var(--color-accent)]'
            : 'bg-[var(--color-accent)] text-white'
        }`}
      >
        cm
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-serif text-lg tracking-tight">Cureocity Mind</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          care, made personal
        </span>
      </span>
    </Link>
  );
}
