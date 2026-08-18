import { Container } from '@/components/ui/Container';

/** Patient record skeleton — identity card and encounter list. */
export default function PatientLoading() {
  return (
    <Container className="py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-[var(--color-line-soft)]" />
        <div className="mt-6 h-44 rounded-2xl bg-[var(--color-line-soft)]" />
        <div className="mt-6 h-72 rounded-2xl bg-[var(--color-line-soft)]" />
      </div>
    </Container>
  );
}
