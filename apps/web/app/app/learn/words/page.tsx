import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { CLINICAL_GLOSSARY, type GlossaryEntry } from '@/lib/clinical-glossary';
import { WordsBrowser, type WordEntry } from '@/components/app/learn/WordsBrowser';

export const dynamic = 'force-dynamic';

/**
 * Sprint 60 — "Words explained": the browsable, filterable glossary.
 *
 * One corner of the Learn Center (not the whole thing). Every clinical
 * term the app uses, in plain language, anchored so search can jump here.
 */
export default function LearnWordsPage() {
  const words: WordEntry[] = Object.entries(CLINICAL_GLOSSARY).map(([key, raw]) => {
    const e: GlossaryEntry = raw;
    return {
      key,
      plainTitle: e.plainTitle,
      term: e.term,
      what: e.what,
      why: e.why,
      example: e.example,
    };
  });

  return (
    <Container className="max-w-3xl py-10">
      <nav className="mb-6 text-sm text-[var(--color-ink-3)]">
        <Link href="/app/learn" className="hover:text-[var(--color-ink)]">
          Learn
        </Link>
        <span className="mx-1.5">/</span>
        <span>Words explained</span>
      </nav>

      <header className="mb-7">
        <h1 className="font-serif text-3xl">Words explained</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Every clinical term the app uses, in plain language. You never have to memorise these —
          they’re here whenever you wonder.
        </p>
      </header>

      <WordsBrowser words={words} />
    </Container>
  );
}
