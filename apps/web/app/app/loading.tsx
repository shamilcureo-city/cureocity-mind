import { Container } from '@/components/ui/Container';

/** Generic skeleton for /app/* while server queries run. */
export default function AppLoading() {
  return (
    <Container className="py-10">
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-56 rounded-lg bg-[var(--color-line-soft)]" />
        <div className="h-40 rounded-2xl bg-[var(--color-line-soft)]" />
        <div className="h-64 rounded-2xl bg-[var(--color-line-soft)]" />
      </div>
    </Container>
  );
}
