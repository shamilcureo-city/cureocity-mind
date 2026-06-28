'use client';

import { useState } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';

/**
 * Inline editor for a completed (unsigned) treatment note. Lets the therapist
 * directly edit the readable note text and save it back to the draft — for a
 * templated note that's one box per section; otherwise it's Summary + named
 * Session topics + The plan. Risk severity and modality aren't exposed here
 * (the server force-preserves them on save).
 */

interface Props {
  note: TherapyNoteV1;
  saving: boolean;
  error?: string | null;
  onSave: (next: TherapyNoteV1) => void | Promise<void>;
  onCancel: () => void;
}

const FIELD =
  'w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-[15px] leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]';

export function NoteEditor({ note, saving, error, onSave, onCancel }: Props) {
  const hasTemplateSections = Boolean(note.templateSections && note.templateSections.length > 0);

  const [sections, setSections] = useState(() =>
    (note.templateSections ?? []).map((s) => ({ title: s.title, body: s.body })),
  );
  const [summary, setSummary] = useState(note.summary ?? note.subjective ?? '');
  const [topics, setTopics] = useState(() =>
    (note.topics ?? []).map((t) => ({ title: t.title, pointsText: t.points.join('\n') })),
  );
  const [plan, setPlan] = useState(note.plan ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  function save(): void {
    let next: TherapyNoteV1;
    if (hasTemplateSections) {
      next = { ...note, templateSections: sections.map((s) => ({ title: s.title, body: s.body })) };
    } else {
      // Guard the schema-required fields up front so an empty box gives a
      // clear inline message instead of an opaque 422 from the server.
      if (!summary.trim()) {
        setLocalError('Summary can’t be empty.');
        return;
      }
      if (!plan.trim()) {
        setLocalError('The plan can’t be empty.');
        return;
      }
      if (topics.some((t) => !t.title.trim())) {
        setLocalError('Each session topic needs a title.');
        return;
      }
      next = {
        ...note,
        summary,
        plan,
        topics: topics.map((t) => ({
          title: t.title.trim(),
          points: t.pointsText
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
        })),
      };
    }
    setLocalError(null);
    void onSave(next);
  }

  return (
    <div className="space-y-6">
      {hasTemplateSections ? (
        sections.map((s, i) => (
          <Field key={i} label={s.title}>
            <textarea
              rows={4}
              value={s.body}
              onChange={(e) =>
                setSections((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                )
              }
              className={FIELD}
            />
          </Field>
        ))
      ) : (
        <>
          <Field label="Summary">
            <textarea
              rows={5}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className={FIELD}
            />
          </Field>

          {topics.length > 0 && (
            <Field label="Session topics">
              <div className="space-y-3">
                {topics.map((t, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-line-soft)] p-3">
                    <input
                      value={t.title}
                      onChange={(e) =>
                        setTopics((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                        )
                      }
                      placeholder="Topic title"
                      className={`${FIELD} mb-2 font-semibold`}
                    />
                    <textarea
                      rows={3}
                      value={t.pointsText}
                      onChange={(e) =>
                        setTopics((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, pointsText: e.target.value } : x)),
                        )
                      }
                      placeholder="One point per line"
                      className={FIELD}
                    />
                  </div>
                ))}
              </div>
            </Field>
          )}

          <Field label="The plan">
            <textarea
              rows={4}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className={FIELD}
            />
          </Field>
        </>
      )}

      {(localError ?? error) && (
        <p className="text-sm text-[var(--color-warn)]">{localError ?? error}</p>
      )}

      <div className="flex items-center gap-2 border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save note'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-[var(--color-ink)]">{label}</label>
      {children}
    </div>
  );
}
