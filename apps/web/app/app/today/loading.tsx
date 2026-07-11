import { Container } from '@/components/ui/Container';

/**
 * TS7.5 — skeleton for the most-opened page in the app. On slow clinic
 * Wi-Fi the Today board used to flash blank while the server composed the
 * day; this sketches the hero + timeline shape immediately.
 */
export default function TodayLoading() {
  return (
    <Container className="py-10">
      <div className="animate-pulse">
        <div className="h-3 w-40 rounded bg-[var(--color-surface-soft)]" />
        <div className="mt-3 h-8 w-52 rounded bg-[var(--color-surface-soft)]" />
        <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-white p-5">
          <div className="flex items-baseline justify-between">
            <div className="h-6 w-44 rounded bg-[var(--color-surface-soft)]" />
            <div className="h-5 w-20 rounded bg-[var(--color-surface-soft)]" />
          </div>
          <div className="mt-3 h-3 w-32 rounded bg-[var(--color-surface-soft)]" />
          <div className="mt-4 h-20 rounded-xl bg-[var(--color-surface-soft)]" />
          <div className="mt-4 h-12 rounded-full bg-[var(--color-surface-soft)]" />
        </div>
        <div className="mt-8 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl border border-[var(--color-line-soft)] bg-white"
            />
          ))}
        </div>
      </div>
    </Container>
  );
}
