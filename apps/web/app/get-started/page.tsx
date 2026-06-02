import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Container } from '@/components/ui/Container';
import { IntakeFlow } from '@/components/intake/IntakeFlow';

export const metadata = {
  title: 'Get matched · Cureocity Mind',
  description: 'A short, private intake. Three thoughtful matches within a day.',
};

export default function GetStartedPage() {
  return (
    <>
      <Header />
      <main className="pb-24">
        <Container className="pt-12">
          <div className="mx-auto max-w-3xl">
            <header className="mb-10 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                Step one
              </p>
              <h1 className="mt-3 font-serif text-5xl leading-tight">
                A short intake. Three matches by tomorrow.
              </h1>
              <p className="mt-3 text-[var(--color-ink-2)]">
                Less than two minutes. Nothing is shared until you say so.
              </p>
            </header>
            <IntakeFlow />
            <p className="mt-6 text-center text-xs text-[var(--color-ink-3)]">
              Your responses are confidential. We do not sell your data, ever.
            </p>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
