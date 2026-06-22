import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { topicBySlug, topicsByGroup, groupByKey, type LearnSection } from '@/lib/learn-content';
import { CLINICAL_GLOSSARY } from '@/lib/clinical-glossary';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ topic: string }>;
}

/**
 * Sprint 60 — a Learn Center topic page.
 *
 * The "big clarity" template: breadcrumb → big title + lede → a one-line
 * summary → calm sections (paragraphs, tinted examples, step lists) →
 * "Try it now" deep link → words it explains → related topics → siblings.
 */
export default async function LearnTopicPage({ params }: PageProps) {
  const { topic: slug } = await params;
  const topic = topicBySlug(slug);
  if (!topic) notFound();

  const group = groupByKey(topic.group);
  const siblings = topicsByGroup(topic.group).filter((t) => t.slug !== topic.slug);
  const related = (topic.related ?? [])
    .map((s) => topicBySlug(s))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <Container className="max-w-3xl py-10">
      <nav className="mb-6 text-sm text-[var(--color-ink-3)]">
        <Link href="/app/learn" className="hover:text-[var(--color-ink)]">
          Learn
        </Link>
        {group && <span className="mx-1.5">/</span>}
        {group && <span>{group.title}</span>}
      </nav>

      <header>
        <h1 className="font-serif text-3xl leading-tight">{topic.title}</h1>
        <p className="mt-2 text-base text-[var(--color-ink-2)]">{topic.lede}</p>
      </header>

      <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-accent-soft)]/40 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          In one sentence
        </p>
        <p className="mt-1 text-[15px] font-medium text-[var(--color-ink)]">{topic.oneLiner}</p>
      </div>

      <div className="mt-8 space-y-8">
        {topic.sections.map((s, i) => (
          <Section key={i} section={s} />
        ))}
      </div>

      {topic.tryIt && (
        <div className="mt-8">
          <Link
            href={topic.tryIt.href}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            ✦ Try it now — {topic.tryIt.label} →
          </Link>
        </div>
      )}

      {topic.glossaryRefs && topic.glossaryRefs.length > 0 && (
        <section className="mt-10 border-t border-[var(--color-line-soft)] pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Words on this page
          </h2>
          <ul className="mt-3 space-y-2">
            {topic.glossaryRefs.map((key) => {
              const e = CLINICAL_GLOSSARY[key];
              return (
                <li key={key} className="text-sm">
                  <span className="font-medium text-[var(--color-ink)]">{e.plainTitle}</span>
                  {e.term && <span className="text-[var(--color-ink-3)]"> · {e.term}</span>}
                  <span className="block text-[var(--color-ink-2)]">{e.what}</span>
                </li>
              );
            })}
          </ul>
          <Link
            href="/app/learn/words"
            className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline"
          >
            See all words explained →
          </Link>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-10 border-t border-[var(--color-line-soft)] pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Related
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {related.map((t) => (
              <Link
                key={t.slug}
                href={`/app/learn/${t.slug}`}
                className="rounded-full border border-[var(--color-line)] bg-white px-3.5 py-1.5 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {t.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="mt-10 border-t border-[var(--color-line-soft)] pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            More in {group?.title ?? 'this section'}
          </h2>
          <ul className="mt-3 space-y-1.5">
            {siblings.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/app/learn/${t.slug}`}
                  className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-accent)]"
                >
                  {t.title} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Container>
  );
}

function Section({ section }: { section: LearnSection }) {
  return (
    <section>
      <h2 className="font-serif text-xl">{section.heading}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-[var(--color-ink)]">
        {section.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {section.steps && section.steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {section.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-[15px] text-[var(--color-ink)]">
              <span
                aria-hidden
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[11px] font-semibold text-[var(--color-accent)]"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {section.example && (
        <p className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm italic text-[var(--color-ink-2)]">
          {section.example}
        </p>
      )}
    </section>
  );
}
