'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  ScribeNoteStyleSchema,
  type ScribeNoteStyle,
} from '@/lib/scribe-personalization-contracts';
import type { useScribeNoteStyle } from '@/lib/use-scribe-personalization';
import { useScribeDoctorTemplates } from '@/lib/use-scribe-doctor-templates';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { ScribeNoteStyleProfileEditor } from './ScribeDoctorTemplatesPanel';
import { Button } from '../ui/Button';

export function ScribeNoteStyleSettings({
  settings,
  followUp,
}: {
  settings: ReturnType<typeof useScribeNoteStyle>;
  followUp: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [profileKey, setProfileKey] = useState<'firstVisit' | 'followUp'>(
    followUp ? 'followUp' : 'firstVisit',
  );
  const [draft, setDraft] = useState<ScribeNoteStyle>(settings.style);
  const [saved, setSaved] = useState(JSON.stringify(settings.style));
  const [templateId, setTemplateId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false),
    mounted = useRef(true);
  const templates = useScribeDoctorTemplates(open);
  const noteTemplates = templates.records.filter(
    (record) => record.body.template.kind === 'note_presentation',
  );
  const dirty = JSON.stringify(draft) !== saved;
  const busy = saving || settings.busy;
  const incoming = JSON.stringify(settings.style);
  const conflict = dirty && incoming !== saved;
  useUnsavedWorkGuard(
    dirty,
    'Your note presentation preview has unsaved changes. Leave without saving them?',
    busy,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!settings.loaded || (!dirty && !busy)) {
      setDraft(settings.style);
      setSaved(incoming);
    }
  }, [settings.style, settings.loaded, incoming, dirty, busy]);
  function discardAllowed() {
    return (
      !busy &&
      (!dirty ||
        window.confirm(
          'Discard the unsaved note presentation preview? Clinical note text will not change.',
        ))
    );
  }
  function close() {
    if (!discardAllowed()) return false;
    setDraft(settings.style);
    setSaved(incoming);
    setOpen(false);
    return true;
  }
  function loadTemplate() {
    if (busy || !templates.loaded || templates.loading) return;
    const template = noteTemplates.find((record) => record.id === templateId)?.body.template;
    if (template?.kind !== 'note_presentation') return;
    if (
      dirty &&
      !window.confirm(
        'Replace the local presentation preview with this template? Clinical note text will not change.',
      )
    )
      return;
    setDraft(structuredClone(template.style));
    setNotice(
      'Template loaded into the local presentation preview only. Save my note style to apply it.',
    );
  }
  async function save() {
    if (!settings.loaded || busy || lock.current || conflict) return;
    const checked = ScribeNoteStyleSchema.safeParse(draft);
    if (!checked.success) {
      setNotice('Give every heading a label and retain every section once.');
      return;
    }
    lock.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const confirmed = await settings.save(checked.data);
      if (!mounted.current) return;
      if (!confirmed) {
        setNotice('Your note presentation was not saved. The preview is still here.');
        return;
      }
      setDraft(checked.data);
      setSaved(JSON.stringify(checked.data));
      setNotice(
        'Your note presentation was saved. Clinical text and source evidence are unchanged.',
      );
      setOpen(false);
    } catch {
      if (mounted.current)
        setNotice('Your note presentation was not saved. The preview is still here.');
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function reloadStyle() {
    if (!discardAllowed()) return;
    setDraft(settings.style);
    setSaved(incoming);
    setNotice(null);
    void settings.reload();
  }
  return (
    <div>
      <details
        open={open}
        onToggle={(event) => {
          if (event.currentTarget.open) setOpen(true);
          else if (!close()) event.currentTarget.open = true;
        }}
        className="rounded-xl border border-[var(--color-line)] bg-white"
      >
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
          My note style
        </summary>
        {open && (
          <div className="space-y-4 border-t border-[var(--color-line)] p-4">
            <p className="text-sm text-[var(--color-ink-2)]">
              Preview the order, headings and spacing for first visits and follow-ups. All seven
              clinical sections and source evidence stay unchanged.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label htmlFor={`${id}-template`} className="text-sm">
                Saved note template
                <select
                  id={`${id}-template`}
                  value={templateId}
                  disabled={busy || templates.loading}
                  onChange={(event) => setTemplateId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-line)] bg-white px-3"
                >
                  <option value="">Choose a personal note template</option>
                  {noteTemplates.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.body.template.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 self-end"
                disabled={busy || !templateId || !templates.loaded || templates.loading}
                onClick={loadTemplate}
              >
                Load template into preview
              </Button>
            </div>
            {templates.loading && (
              <p role="status" className="text-sm">
                Loading personal note templates…
              </p>
            )}
            {templates.error && (
              <p role="alert" className="text-sm text-[var(--color-warn)]">
                {templates.error}
              </p>
            )}
            {templates.loaded && !noteTemplates.length && (
              <p className="text-sm text-[var(--color-ink-2)]">
                No personal note templates saved yet. Create one in your template library.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={templates.loading || busy}
                onClick={() => void templates.reload()}
              >
                Reload templates
              </Button>
              <a
                href="/app/clinic/templates"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Manage doctor templates (new tab)
              </a>
            </div>
            {conflict && (
              <p role="alert" className="text-sm text-[var(--color-warn)]">
                Your saved style changed while this preview was being edited. Keep any needed
                headings, then reload the saved style before applying a new preview.
              </p>
            )}
            <ScribeNoteStyleProfileEditor
              style={draft}
              profileKey={profileKey}
              onProfileKeyChange={setProfileKey}
              onChange={(next) => {
                setDraft(next);
                setNotice(null);
              }}
              disabled={busy || !settings.loaded}
              idPrefix={`${id}-style`}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11"
                disabled={!settings.loaded || busy || conflict}
                onClick={() => void save()}
              >
                Save my note style
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  if (discardAllowed()) {
                    setDraft(structuredClone(DEFAULT_SCRIBE_NOTE_STYLE));
                    setNotice('Default presentation loaded into preview only.');
                  }
                }}
              >
                Reset preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => close()}
              >
                Cancel preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={reloadStyle}
              >
                Reload saved style
              </Button>
            </div>
            <p className="text-xs text-[var(--color-ink-2)]">
              Changing visit profiles preserves both previews. Only Save my note style applies these
              preferences. It never rewrites, signs or publishes a note.
            </p>
          </div>
        )}
      </details>
      {settings.error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-warn)]">
          {settings.error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
