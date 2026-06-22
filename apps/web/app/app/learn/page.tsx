import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { LEARN_GROUPS, topicsByGroup, LEARN_TOPICS } from '@/lib/learn-content';
import { CLINICAL_GLOSSARY } from '@/lib/clinical-glossary';
import { LearnSearch, type SearchTopic, type SearchWord } from '@/components/app/learn/LearnSearch';

export const dynamic = 'force-dynamic';

/**
 * Sprint 60 — the Learn & Help Center hub.
 *
 * Replaces the old flat onboarding scroll with a navigable, searchable
 * destination: a search box over every topic + word, then topics grouped
 * the way a therapist's day flows, then "words explained" and account
 * links, then a help block (anchored for the sidebar's "Get Help").
 */

const SUPPORTING_LINKS = [
  {
    href: '/app/practice-assistant',
    label: 'Practice Assistant',
    desc: 'Ask questions about your own caseload — “who haven’t I seen in 30 days?”',
  },
  {
    href: '/app/me',
    label: 'My practice',
    desc: 'Your own tempo and decision split — for reflection, not comparison.',
  },
  {
    href: '/app/learn/words',
    label: 'Words explained',
    desc: 'Every clinical term the app uses, in plain language.',
  },
];

export default function LearnPage() {
  const searchTopics: SearchTopic[] = LEARN_TOPICS.map((t) => ({
    slug: t.slug,
    title: t.title,
    lede: t.lede,
    groupTitle: LEARN_GROUPS.find((g) => g.key === t.group)?.title ?? '',
  }));
  const searchWords: SearchWord[] = Object.entries(CLINICAL_GLOSSARY).map(([key, e]) => ({
    key,
    plainTitle: e.plainTitle,
    term: e.term,
    what: e.what,
  }));

  return (
    <Container className="py-10">
      <header className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Learn &amp; Help
        </p>
        <h1 className="mt-2 font-serif text-3xl">Everything, explained simply</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Short, plain-language guides to every part of the app — no jargon, no rush. Search for
          anything, or browse by what you’re doing.
        </p>
      </header>

      <div className="mb-10 max-w-2xl">
        <LearnSearch topics={searchTopics} words={searchWords} />
      </div>

      <div className="space-y-10">
        {LEARN_GROUPS.map((group) => {
          const topics = topicsByGroup(group.key);
          if (topics.length === 0) return null;
          return (
            <section key={group.key}>
              <div className="mb-3">
                <h2 className="font-serif text-xl">{group.title}</h2>
                <p className="text-sm text-[var(--color-ink-3)]">{group.blurb}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topics.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/app/learn/${t.slug}`}
                    className="block rounded-2xl border border-[var(--color-line)] bg-white p-5 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                  >
                    <p className="font-serif text-base text-[var(--color-ink)]">{t.title}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
                      {t.lede}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          More in your account
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SUPPORTING_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-2xl border border-[var(--color-line)] bg-white p-5 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            >
              <p className="font-serif text-base text-[var(--color-ink)]">{l.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-2)]">{l.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section
        id="help"
        className="mt-12 scroll-mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6"
      >
        <h2 className="font-serif text-xl">Still stuck?</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          The fastest answers grounded in your own data come from the{' '}
          <Link href="/app/practice-assistant" className="text-[var(--color-accent)] underline">
            Practice Assistant
          </Link>
          . For billing, account, or anything urgent, reach out to Sharafath directly — we’re a
          message away.
        </p>
      </section>
    </Container>
  );
}
