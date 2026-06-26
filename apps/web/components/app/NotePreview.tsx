'use client';

import { useEffect, useState } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { EduSection, InlineExplainer } from './EduHeading';
import { glossary } from '../../lib/clinical-glossary';
import {
  formatNoteSections,
  isNoteFormat,
  NOTE_FORMATS,
  NOTE_FORMAT_HELP,
  NOTE_FORMAT_LABEL,
  type NoteFormat,
} from '../../lib/note-format';

interface Props {
  note: TherapyNoteV1;
  signedAt?: string | null;
  signedBy?: string | null;
}

const FORMAT_KEY = 'cm.noteFormat';

/**
 * Renders a TherapyNoteV1 in a clinician-friendly long-form layout.
 *
 * Sprint 62b — a format switch (SOAP / DAP / BIRP / Narrative) lets the
 * therapist read the same note arranged the way they write. SOAP keeps the
 * rich, education-annotated layout; the others are a deterministic re-map
 * of the same content (see lib/note-format.ts). The choice is remembered
 * per-device (localStorage); it never changes what's stored or signed.
 */
export function NotePreview({ note, signedAt, signedBy }: Props) {
  const topics = extractTopics(note.assessment);
  const planItems = extractTopics(note.plan);
  // Sprint 70 — prefer the model's plain summary + named session topics
  // (the readable layout) when present; otherwise fall back to the SOAP view.
  const hasSummary = Boolean(note.summary && note.summary.trim());
  const hasNamedTopics = Boolean(note.topics && note.topics.length > 0);

  const [format, setFormat] = useState<NoteFormat>('SOAP');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FORMAT_KEY);
      if (isNoteFormat(saved)) setFormat(saved);
    } catch {
      // localStorage unavailable — stay on SOAP.
    }
  }, []);
  function pick(f: NoteFormat): void {
    setFormat(f);
    try {
      window.localStorage.setItem(FORMAT_KEY, f);
    } catch {
      // ignore
    }
  }

  return (
    <article className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone="muted">{note.modality}</Badge>
          <Badge tone="muted">v{note.version}</Badge>
        </div>
        {signedAt ? (
          <div className="text-right text-xs text-[var(--color-ink-3)]">
            <p>
              <span className="font-medium text-[var(--color-accent)]">✓ Signed</span> ·{' '}
              {new Date(signedAt).toLocaleString()}
            </p>
            {signedBy && <p className="mt-0.5">by {signedBy}</p>}
          </div>
        ) : (
          <Badge tone="warn">Unsigned draft</Badge>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Format</span>
        {NOTE_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => pick(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              format === f
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]'
            }`}
          >
            {NOTE_FORMAT_LABEL[f]}
          </button>
        ))}
        <InlineExplainer entry={NOTE_FORMAT_HELP} label="Which should I pick?" />
      </div>

      {format === 'SOAP' ? (
        <>
          {/* Sprint 70 — readable layout: a plain "Summary" + named "Session
              topics" when the note carries them (the reference template);
              older notes without these fields fall back to the SOAP sections,
              and the SOAP fields stay authoritative underneath. */}
          <EduSection term={hasSummary ? 'note.summary' : 'soap.summary'}>
            {hasSummary ? (
              <p className="whitespace-pre-line text-[15px] leading-relaxed">{note.summary}</p>
            ) : (
              <>
                <p className="whitespace-pre-line">{note.subjective}</p>
                {note.objective.trim() && (
                  <p className="mt-3 whitespace-pre-line text-[var(--color-ink-2)]">
                    {note.objective}
                  </p>
                )}
              </>
            )}
          </EduSection>

          <EduSection term={hasNamedTopics ? 'note.sessionTopics' : 'soap.topics'}>
            {hasNamedTopics ? (
              <div className="space-y-5">
                {note.topics!.map((t, i) => (
                  <section key={i}>
                    <h4 className="font-serif text-base text-[var(--color-ink)]">{t.title}</h4>
                    {t.points.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {t.points.map((p, j) => (
                          <li key={j} className="flex items-start gap-2 text-[var(--color-ink)]">
                            <span
                              aria-hidden
                              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                            />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            ) : topics.length === 0 ? (
              <p className="text-[var(--color-ink-2)]">{note.assessment}</p>
            ) : (
              <ul className="space-y-2">
                {topics.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                    />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </EduSection>

          <EduSection term="soap.plan">
            {planItems.length === 0 ? (
              <p className="text-[var(--color-ink-2)]">{note.plan}</p>
            ) : (
              <ul className="space-y-2">
                {planItems.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[var(--color-line)] bg-white text-[10px] text-[var(--color-ink-3)]"
                    >
                      ◯
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </EduSection>
        </>
      ) : (
        formatNoteSections(note, format).map((sec, i) => (
          <FormatSectionView key={i} heading={sec.heading} term={sec.term} body={sec.body} />
        ))
      )}

      {note.modalitySpecific && Object.keys(note.modalitySpecific).length > 0 && (
        <Section heading={`${note.modality} specifics`}>
          <pre className="overflow-x-auto rounded-xl bg-[var(--color-surface-soft)] p-4 text-xs text-[var(--color-ink-2)]">
            {JSON.stringify(note.modalitySpecific, null, 2)}
          </pre>
        </Section>
      )}

      {note.phaseHints.length > 0 && (
        <footer className="border-t border-[var(--color-line-soft)] pt-5">
          <InlineExplainer
            entry={glossary('phaseHints')}
            label={
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                {glossary('phaseHints').plainTitle}
              </span>
            }
          />
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {note.phaseHints.map((h, i) => (
              <li key={i}>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1 text-xs">
                  <strong className="text-[var(--color-ink)]">{h.phase.replace(/_/g, ' ')}</strong>
                  <span className="text-[var(--color-ink-3)]">
                    · {(h.confidence * 100).toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-serif text-xl">{heading}</h3>
      <div className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink)]">{children}</div>
    </section>
  );
}

/** A non-SOAP format section: plain title + small clinical term + prose. */
function FormatSectionView({
  heading,
  term,
  body,
}: {
  heading: string;
  term?: string;
  body: string;
}) {
  return (
    <section>
      <h3 className="font-serif text-xl leading-tight text-[var(--color-ink)]">{heading}</h3>
      {term && (
        <p className="mt-0.5 text-xs uppercase tracking-wider text-[var(--color-ink-3)]">{term}</p>
      )}
      <div className="mt-2.5 whitespace-pre-line text-[15px] leading-relaxed text-[var(--color-ink)]">
        {body.trim() ? body : <span className="text-[var(--color-ink-3)]">—</span>}
      </div>
    </section>
  );
}

function extractTopics(block: string): string[] {
  const cleaned = block
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean);
  if (cleaned.length >= 2) return cleaned;
  // Fall back to splitting on sentence boundaries if the model returned one paragraph.
  const sentences = block
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return sentences.length >= 2 ? sentences : [];
}
