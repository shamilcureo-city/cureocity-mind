import { Container } from '@/components/ui/Container';

/** Session workspace skeleton — header, tab bar, content card. */
export default function SessionLoading() {
  return (
    <Container className="py-8">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-[var(--color-line-soft)]" />
        <div className="mt-6 h-9 w-64 rounded-lg bg-[var(--color-line-soft)]" />
        <div className="mt-2 h-4 w-40 rounded bg-[var(--color-line-soft)]" />
        <div className="mt-8 flex gap-2 border-b border-[var(--color-line-soft)] pb-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 rounded-lg bg-[var(--color-line-soft)]" />
          ))}
        </div>
        <div className="mt-6 h-96 rounded-2xl bg-[var(--color-line-soft)]" />
      </div>
    </Container>
  );
}
