'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { builtinTemplatesByCategory } from '../../lib/builtin-templates';

/**
 * Sprint 70 (template library) — the compact "BASE" template dropdown on the
 * note. Lists the built-in catalog (grouped) and the therapist's own
 * templates; choosing one applies it to the session and re-generates the note
 * into that structure (via `onApply`). A trailing "Create a template…" option
 * jumps to the builder. Pre-sign only.
 */

const CREATE_VALUE = '__create__';

interface Props {
  sessionId: string;
  currentTemplateId: string | null;
  disabled?: boolean;
  /** Applied → the parent re-generates the note (e.g. triggerGeneration). */
  onApply: () => void | Promise<void>;
}

export function TemplatePicker({ sessionId, currentTemplateId, disabled, onApply }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
  const [selected, setSelected] = useState<string>(currentTemplateId ?? '');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/templates', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as {
          items: { id: string; name: string; isDefault: boolean }[];
        };
        if (!cancelled) setItems(body.items);
      } catch {
        // ignore — built-ins still show
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply(templateId: string | null): Promise<void> {
    if (applying) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      if (res.ok) await onApply();
    } catch {
      // surfaced by the note panel's own error states
    } finally {
      setApplying(false);
    }
  }

  function onChange(value: string): void {
    if (value === CREATE_VALUE) {
      router.push('/app/templates');
      return;
    }
    setSelected(value);
    void apply(value === '' ? null : value);
  }

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Note template</span>
      <select
        value={selected}
        disabled={disabled || applying}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full border border-[var(--color-line)] bg-white py-1.5 pl-3.5 pr-8 text-sm font-medium text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
      >
        <option value="">Built-in (SOAP)</option>
        {builtinTemplatesByCategory().map((g) => (
          <optgroup key={g.category} label={g.category}>
            {g.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.recommended ? ' ★' : ''}
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
        <option value={CREATE_VALUE}>＋ Create a template…</option>
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3 text-[var(--color-ink-3)]">
        {applying ? '…' : '▾'}
      </span>
    </label>
  );
}
