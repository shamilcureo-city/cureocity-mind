'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useScribeDoctorTemplates } from '@/lib/use-scribe-doctor-templates';
import {
  SCRIBE_BUILTIN_DOCTOR_TEMPLATES,
  renderScribeDocumentTemplate,
  type ScribeDoctorTemplate,
} from '@/lib/scribe-doctor-templates';
import type { ScribeConsultationDocumentType } from '@/lib/scribe-consultation-documents';

/** Only reusable blank fields are read here. Patient text is never sent to the library. */
export function ScribeDocumentTemplatePicker({
  documentType,
  disabled,
  onAppend,
}: {
  documentType: ScribeConsultationDocumentType;
  disabled: boolean;
  onAppend: (text: string) => void;
}) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState('');
  const library = useScribeDoctorTemplates(opened);
  const compatible = (template: ScribeDoctorTemplate) =>
    template.kind === 'document_skeleton' && template.documentType === documentType;
  const choices = [
    ...SCRIBE_BUILTIN_DOCTOR_TEMPLATES.flatMap((template, index) =>
      compatible(template)
        ? [{ key: `starter-${index}`, label: `${template.name} (starter)`, template }]
        : [],
    ),
    ...library.records.flatMap((record) =>
      compatible(record.body.template)
        ? [{ key: record.id, label: record.body.template.name, template: record.body.template }]
        : [],
    ),
  ];
  const template = choices.find((choice) => choice.key === selected)?.template;
  const text = template?.kind === 'document_skeleton' ? renderScribeDocumentTemplate(template) : '';
  return (
    <details
      className="my-4 rounded-lg border border-[var(--color-line)] bg-white"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        Use a document template
      </summary>
      {opened && (
        <div className="space-y-3 border-t border-[var(--color-line)] p-3 text-sm">
          <p className="max-w-3xl text-[var(--color-ink-2)]">
            Append blank completion fields to your additions. Existing wording stays unchanged;
            complete or remove each marked field before review.
          </p>
          <label htmlFor={`${id}-template`} className="block font-semibold">
            Template for this document
          </label>
          <select
            id={`${id}-template`}
            value={selected}
            disabled={disabled || library.busy}
            onChange={(event) => setSelected(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">Choose a template</option>
            {choices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
          {library.loading && <p role="status">Loading your saved templates…</p>}
          {library.error && (
            <p role="alert" className="text-[var(--color-warn)]">
              Your library could not be loaded: {library.error} Built-in starters remain available.
            </p>
          )}
          {text && (
            <section
              aria-label="Template completion fields preview"
              className="rounded-lg bg-[var(--color-accent-soft)] p-3"
            >
              <h5 className="mb-2 font-semibold">Fields to append</h5>
              <p className="whitespace-pre-wrap break-words leading-6">{text}</p>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || !text || library.busy}
              className="min-h-11 rounded-lg bg-[var(--color-ink)] px-4 text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => {
                if (text && !disabled) onAppend(text);
              }}
            >
              Append completion fields
            </button>
            <button
              type="button"
              disabled={library.loading || library.busy}
              className="min-h-11 rounded-lg border border-[var(--color-line)] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => void library.reload()}
            >
              Reload templates
            </button>
            <Link
              href="/app/clinic/templates"
              className="inline-flex min-h-11 items-center px-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Manage my templates
            </Link>
          </div>
        </div>
      )}
    </details>
  );
}
