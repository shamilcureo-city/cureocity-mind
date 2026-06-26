'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { builtinTemplatesByCategory } from '../../lib/builtin-templates';

/**
 * Sprint 70 (template library, phase B) — the "BASE" picker on the note.
 *
 * Lists the therapist's note templates (plus the built-in SOAP structure and
 * a link to create one). Choosing a template applies it to the session and
 * re-generates the note into that template's structure (Pass 2 reads
 * `session.noteTemplateId`), reusing the normal generate-note pipeline via
 * `onApply`. Pre-sign only — a signed note is immutable.
 */

interface TemplateOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface Props {
  sessionId: string;
  currentTemplateId: string | null;
  disabled?: boolean;
  /** Applied → the parent re-generates the note (e.g. triggerGeneration). */
  onApply: () => void | Promise<void>;
}

export function TemplatePicker({ sessionId, currentTemplateId, disabled, onApply }: Props) {
  const [items, setItems] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState<string>(currentTemplateId ?? '');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/templates', { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load templates');
        const body = (await res.json()) as {
          items: { id: string; name: string; isDefault: boolean }[];
        };
        if (!cancelled) {
          setItems(body.items.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault })));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply(templateId: string | null): Promise<void> {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? 'Could not apply template');
      }
      await onApply();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Template</span>
      <select
        value={selected}
        disabled={disabled || applying || loading}
        onChange={(e) => {
          const v = e.target.value;
          setSelected(v);
          void apply(v === '' ? null : v);
        }}
        className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
      >
        <option value="">Built-in (SOAP)</option>
        {builtinTemplatesByCategory().map((g) => (
          <optgroup key={g.category} label={g.category}>
            {g.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
        {items.length > 0 && (
          <optgroup label="Your templates">
            {items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <Link href="/app/templates" className="text-xs text-[var(--color-accent)] underline">
        ＋ Create
      </Link>
      {applying && <span className="text-xs text-[var(--color-ink-3)]">Re-generating…</span>}
      {error && <span className="text-xs text-[var(--color-warn)]">{error}</span>}
    </div>
  );
}
