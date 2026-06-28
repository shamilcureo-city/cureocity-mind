'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { NoteTemplate, TemplateSection } from '@cureocity/contracts';
import { builtinTemplatesByCategory, type BuiltinTemplate } from '../../lib/builtin-templates';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input, Label, Textarea } from '../ui/Field';

/** A pre-filled starting point for the create modal (e.g. from a built-in). */
type TemplateSeed = { name: string; description?: string; sections: TemplateSection[] };

type EditTarget =
  | { kind: 'new'; seed?: TemplateSeed }
  | { kind: 'edit'; template: NoteTemplate }
  | null;

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary', title: 'Summary' },
  { id: 'session_topics', title: 'Session Topics' },
  { id: 'plan', title: 'Plan' },
];

/** title → a stable lowercase_underscore section id. */
function slugifySectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Map a read-only built-in into an editable custom-template seed. */
function builtinSeed(t: BuiltinTemplate): TemplateSeed {
  return {
    name: t.name,
    description: `Based on the built-in ${t.name} template.`,
    sections: t.sections.map((s, i) => ({
      id: slugifySectionId(s.title) || `section_${i + 1}`,
      title: s.title,
      ...(s.hint ? { hint: s.hint } : {}),
    })),
  };
}

export function TemplatesEditor() {
  const [items, setItems] = useState<NoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<EditTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/templates');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { items: NoteTemplate[] };
      setItems(body.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm('Delete this template?')) return;
      try {
        const res = await fetch(`/api/v1/templates/${id}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  const setDefault = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/v1/templates/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isDefault: true }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  return (
    <div className="space-y-10">
      <div className="flex justify-end">
        <Button onClick={() => setTarget({ kind: 'new' })}>+ Create template</Button>
      </div>

      {error && (
        <Card className="border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {error}
        </Card>
      )}

      {/* Built-in catalog — always available. These aren't DB rows, so they
          can't be edited or deleted, but "use as a starting point" seeds a
          new custom template from one. */}
      <section>
        <h2 className="font-serif text-xl">Built-in templates</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Ready-made note structures, always available. Pick one on a note from the{' '}
          <span className="font-medium text-[var(--color-ink)]">BASE</span> menu, or use one as a
          starting point for your own.
        </p>
        <div className="mt-4 space-y-6">
          {builtinTemplatesByCategory().map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                {group.category}
              </h3>
              <ul className="mt-2 grid gap-3 md:grid-cols-2">
                {group.templates.map((t) => (
                  <li key={t.id}>
                    <Card className="flex h-full flex-col p-5">
                      <header className="flex items-baseline justify-between gap-3">
                        <h4 className="font-serif text-lg">{t.name}</h4>
                        <div className="flex shrink-0 items-center gap-2">
                          {t.recommended && <Badge tone="accent">Recommended</Badge>}
                          <Badge tone="muted">
                            {t.sections.length} section{t.sections.length === 1 ? '' : 's'}
                          </Badge>
                        </div>
                      </header>
                      <ul className="mt-3 flex flex-wrap gap-1 text-xs">
                        {t.sections.map((s) => (
                          <li
                            key={s.title}
                            className="rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-[var(--color-ink-2)]"
                          >
                            {s.title}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto flex justify-end border-t border-[var(--color-line-soft)] pt-3">
                        <button
                          type="button"
                          onClick={() => setTarget({ kind: 'new', seed: builtinSeed(t) })}
                          className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs text-[var(--color-ink)] hover:border-[var(--color-accent)]"
                        >
                          use as a starting point
                        </button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* The therapist's own editable templates. */}
      <section>
        <h2 className="font-serif text-xl">Your templates</h2>
        {loading ? (
          <Card className="mt-4 p-10 text-center text-sm text-[var(--color-ink-3)]">Loading…</Card>
        ) : items.length === 0 ? (
          <Card className="mt-4 p-10 text-center">
            <p className="font-serif text-xl">No custom templates yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
              New notes use the built-in SOAP layout. Create a template — or start from a built-in
              above — if you want a different structure.
            </p>
          </Card>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((t) => (
              <li key={t.id}>
                <Card className="p-5">
                  <header className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-lg">{t.name}</h3>
                      {t.description && (
                        <p className="mt-1 text-sm text-[var(--color-ink-2)]">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {t.isDefault && <Badge tone="accent">Default</Badge>}
                      <Badge tone="muted">
                        {t.sections.length} section{t.sections.length === 1 ? '' : 's'}
                      </Badge>
                    </div>
                  </header>

                  <ul className="mt-3 flex flex-wrap gap-1 text-xs">
                    {t.sections.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5 text-[var(--color-ink-2)]"
                      >
                        {s.title}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-line-soft)] pt-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setTarget({ kind: 'edit', template: t })}
                      className="rounded-full bg-[var(--color-ink)] px-3 py-1 text-[var(--color-surface)] hover:bg-[var(--color-ink-2)]"
                    >
                      edit
                    </button>
                    {!t.isDefault && (
                      <button
                        type="button"
                        onClick={() => void setDefault(t.id)}
                        className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-[var(--color-ink)] hover:border-[var(--color-accent)]"
                      >
                        set default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(t.id)}
                      className="ml-auto text-[var(--color-warn)] hover:underline"
                    >
                      delete
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {target && (
        <TemplateModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  target,
  onClose,
  onSaved,
}: {
  target: { kind: 'new'; seed?: TemplateSeed } | { kind: 'edit'; template: NoteTemplate };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = target.kind === 'edit';
  const seed = target.kind === 'new' ? target.seed : undefined;
  const [name, setName] = useState(isEdit ? target.template.name : (seed?.name ?? ''));
  const [description, setDescription] = useState(
    isEdit ? (target.template.description ?? '') : (seed?.description ?? ''),
  );
  const [sections, setSections] = useState<TemplateSection[]>(
    isEdit ? target.template.sections : (seed?.sections ?? DEFAULT_SECTIONS),
  );
  const [isDefault, setIsDefault] = useState(isEdit ? target.template.isDefault : false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateSection(idx: number, patch: Partial<TemplateSection>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addSection() {
    setSections((prev) => [
      ...prev,
      {
        id: `section_${prev.length + 1}`,
        title: `New section ${prev.length + 1}`,
      },
    ]);
  }

  function removeSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    setSections((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name,
        sections,
        isDefault,
      };
      if (description.trim()) body['description'] = description.trim();
      else if (isEdit) body['description'] = null;

      const res = await fetch(
        isEdit ? `/api/v1/templates/${target.template.id}` : '/api/v1/templates',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto p-7">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">
            {isEdit
              ? `Edit ${target.template.name}`
              : seed
                ? `New template from ${seed.name}`
                : 'New template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            cancel
          </button>
        </header>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Intake SOAP, EMDR closure debrief"
            />
          </div>
          <div>
            <Label htmlFor="tpl-desc" hint="optional · what is this template for?">
              Description
            </Label>
            <Textarea
              id="tpl-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          <fieldset className="rounded-2xl border border-[var(--color-line-soft)] p-4">
            <legend className="px-2 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Sections (1–20)
            </legend>

            <ul className="mt-2 space-y-3">
              {sections.map((s, idx) => (
                <li
                  key={idx}
                  className="rounded-xl border border-[var(--color-line-soft)] bg-white p-3"
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <Label htmlFor={`sec-id-${idx}`} hint="lowercase + underscores">
                        Section id
                      </Label>
                      <Input
                        id={`sec-id-${idx}`}
                        value={s.id}
                        onChange={(e) =>
                          updateSection(idx, {
                            id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                          })
                        }
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`sec-title-${idx}`}>Title</Label>
                      <Input
                        id={`sec-title-${idx}`}
                        value={s.title}
                        onChange={(e) => updateSection(idx, { title: e.target.value })}
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor={`sec-hint-${idx}`} hint="optional · guidance for the model">
                        Hint
                      </Label>
                      <Textarea
                        id={`sec-hint-${idx}`}
                        rows={2}
                        value={s.hint ?? ''}
                        onChange={(e) => updateSection(idx, { hint: e.target.value || undefined })}
                        maxLength={1000}
                        placeholder="e.g. 1-2 sentences. Quote any direct client utterances."
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => moveSection(idx, -1)}
                      disabled={idx === 0}
                      className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      ↑ move up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(idx, 1)}
                      disabled={idx === sections.length - 1}
                      className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      ↓ move down
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(idx)}
                      disabled={sections.length <= 1}
                      className="text-[var(--color-warn)] hover:underline disabled:opacity-40"
                    >
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={addSection}
                disabled={sections.length >= 20}
              >
                + Add section
              </Button>
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-ink)]">
              Make this the default template for new notes
            </span>
          </label>

          {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
