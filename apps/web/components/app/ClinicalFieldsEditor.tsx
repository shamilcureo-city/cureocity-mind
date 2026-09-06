'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { noteEditIsDirty } from '../../lib/canonical-note-edit';

interface Field {
  key: string;
  label: string;
  required?: boolean;
}

/** Keep PHI in memory until an explicit save; never put unsaved notes in localStorage. */
export function ClinicalFieldsEditor({
  initial,
  fields,
  saving,
  error,
  onSave,
  onCancel,
  hasDerivedView,
}: {
  initial: Record<string, string>;
  fields: readonly Field[];
  saving: boolean;
  error?: string | null;
  onSave: (values: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
  hasDerivedView: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [validation, setValidation] = useState<string | null>(null);
  const dirty = useMemo(() => noteEditIsDirty(initial, values), [initial, values]);
  const id = useId();
  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (target.pathname === window.location.pathname && target.search === window.location.search)
        return;
      if (saving || !window.confirm('Your note has unsaved changes. Leave without saving them?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, saving]);

  function save() {
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (missing) {
      setValidation(`${missing.label} cannot be empty.`);
      return;
    }
    setValidation(null);
    void onSave(values);
  }

  return (
    <div className="space-y-5">
      <p role="status" className="text-sm text-[var(--color-ink-2)]">
        {saving
          ? 'Saving your corrections…'
          : dirty
            ? 'Unsaved changes — save before leaving this note.'
            : 'Editing the source clinical fields.'}
      </p>
      {hasDerivedView && (
        <p className="rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-ink-2)]">
          Saving corrections replaces older generated summary/template wording and clears generated
          evidence links and phase hints. Safety flags and structured modality observations are
          retained for clinical review.
        </p>
      )}
      {fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`${id}-${field.key}`} className="mb-2 block text-sm font-semibold">
            {field.label}
          </label>
          <textarea
            id={`${id}-${field.key}`}
            rows={4}
            value={values[field.key] ?? ''}
            disabled={saving}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
            }
            className="w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-base leading-relaxed text-[var(--color-ink)]"
          />
        </div>
      ))}
      {(validation ?? error) && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {validation ?? error}
        </p>
      )}
      <div className="flex gap-2 border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save note'}
        </Button>
        <Button
          variant="secondary"
          disabled={saving}
          onClick={() => {
            if (!dirty || window.confirm('Discard your unsaved note changes?')) onCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
