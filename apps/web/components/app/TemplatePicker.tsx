'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { builtinTemplatesByCategory, resolveBuiltinTemplate } from '../../lib/builtin-templates';

/**
 * The "BASE" template menu on the note. A categorised dropdown (matching the
 * reference): the built-in catalog grouped by category + the therapist's own
 * templates, each row showing whether it's the active note or "Click to
 * generate". Choosing one applies it to the session and re-generates the note
 * into that structure (via `onApply`). Pre-sign only.
 */

interface CustomTemplate {
  id: string;
  name: string;
  isDefault: boolean;
}

interface Props {
  sessionId: string;
  currentTemplateId: string | null;
  disabled?: boolean;
  /** Sprint 72 — INTAKE relabels the no-template default row to "Initial
   *  assessment (standard)" (the standard eight-section intake) instead of
   *  "Built-in (SOAP)", which is meaningless for a first assessment. */
  kind?: 'INTAKE' | 'TREATMENT';
  /** Applied → the parent re-generates the note (e.g. triggerGeneration). */
  onApply: () => void | Promise<void>;
}

export function TemplatePicker({ sessionId, currentTemplateId, disabled, kind, onApply }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<CustomTemplate[]>([]);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeId = currentTemplateId ?? '';
  // The no-template default: the standard intake for INTAKE, plain SOAP else.
  const standardLabel = kind === 'INTAKE' ? 'Initial assessment (standard)' : 'Built-in (SOAP)';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/templates', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { items: CustomTemplate[] };
        if (!cancelled) setItems(body.items);
      } catch {
        // ignore — built-ins still show
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function nameFor(id: string): string {
    if (!id) return standardLabel;
    const builtin = resolveBuiltinTemplate(id);
    if (builtin) return builtin.name;
    return items.find((x) => x.id === id)?.name ?? 'Template';
  }

  async function apply(templateId: string | null): Promise<void> {
    if (applying) return;
    setOpen(false);
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

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled || applying}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white py-1.5 pl-3.5 pr-3 text-sm font-medium text-[var(--color-ink)] outline-none hover:border-[var(--color-ink-3)] focus:border-[var(--color-accent)] disabled:opacity-60"
      >
        <span>{nameFor(activeId)}</span>
        <span aria-hidden className="text-xs text-[var(--color-ink-3)]">
          {applying ? '…' : '▾'}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 max-h-[420px] w-80 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-white p-1.5 shadow-[0_12px_30px_rgba(15,27,42,0.13)]">
          <Row label={standardLabel} active={activeId === ''} onClick={() => void apply(null)} />

          {builtinTemplatesByCategory().map((g) => (
            <div key={g.category}>
              <Header>{g.category}</Header>
              {g.templates.map((t) => (
                <Row
                  key={t.id}
                  label={`${t.name}${t.recommended ? ' ★' : ''}`}
                  active={activeId === t.id}
                  onClick={() => void apply(t.id)}
                />
              ))}
            </div>
          ))}

          {items.length > 0 && (
            <div>
              <Header>Your templates</Header>
              {items.map((t) => (
                <Row
                  key={t.id}
                  label={`${t.name}${t.isDefault ? ' (default)' : ''}`}
                  active={activeId === t.id}
                  onClick={() => void apply(t.id)}
                />
              ))}
            </div>
          )}

          <Header>Custom</Header>
          <button
            type="button"
            onClick={() => router.push('/app/templates')}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-[var(--color-accent)] hover:bg-[var(--color-surface-soft)]"
          >
            ＋ Create a template…
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
      {children}
    </p>
  );
}

function Row({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
        active
          ? 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-ink)]'
          : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]'
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-accent)]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          Selected
        </span>
      ) : (
        <span className="shrink-0 text-xs text-[var(--color-ink-3)]">Click to generate</span>
      )}
    </button>
  );
}
