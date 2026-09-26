'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ScribeShortcutSchema,
  SCRIBE_NOTE_LABELS,
  type ScribeNarrativeField,
  type ScribeShortcutRecord,
} from '@/lib/scribe-personalization-contracts';
import {
  applyScribeCorrection,
  previewScribeCorrection,
  undoScribeCorrection,
  type ScribeCorrection,
} from '@/lib/scribe-corrections';
import { useScribeShortcuts } from '@/lib/use-scribe-personalization';
import { Button } from '../ui/Button';

const FIELDS: ScribeNarrativeField[] = ['chiefComplaint', 'hpi', 'assessment', 'plan'];
const inputClass =
  'mt-1 min-h-11 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm';

export function ScribeNoteTools({
  draft,
  onChange,
  editorRef,
}: {
  draft: Record<ScribeNarrativeField, string>;
  onChange: (field: ScribeNarrativeField, value: string) => void;
  editorRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<ScribeNarrativeField>('hpi');
  const [command, setCommand] = useState('');
  const [proposal, setProposal] = useState<{
    field: ScribeNarrativeField;
    change: ScribeCorrection;
  } | null>(null);
  const [undo, setUndo] = useState<typeof proposal>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phraseTitle, setPhraseTitle] = useState('');
  const [phraseText, setPhraseText] = useState('');
  const [editing, setEditing] = useState<ScribeShortcutRecord | undefined>();
  const [removing, setRemoving] = useState<ScribeShortcutRecord | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const phrases = useScribeShortcuts(open);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        if (detailsRef.current) detailsRef.current.open = true;
        commandRef.current?.focus();
      }
    };
    editor.addEventListener('keydown', keydown);
    return () => editor.removeEventListener('keydown', keydown);
  }, [editorRef]);
  function preview() {
    setError(null);
    setNotice(null);
    try {
      setProposal({ field, change: previewScribeCorrection(draft[field], command) });
    } catch (reason) {
      setProposal(null);
      setError((reason as Error).message);
    }
  }
  function apply() {
    if (!proposal) return;
    try {
      onChange(proposal.field, applyScribeCorrection(draft[proposal.field], proposal.change));
      setUndo(proposal);
      setProposal(null);
      setNotice('Correction applied to this draft. Save corrections when you finish.');
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function revert() {
    if (!undo) return;
    try {
      onChange(undo.field, undoScribeCorrection(draft[undo.field], undo.change));
      setUndo(null);
      setNotice('Last quick correction undone.');
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function savePhrase() {
    const parsed = ScribeShortcutSchema.safeParse({
      type: 'phrase',
      title: phraseTitle,
      field,
      text: phraseText,
    });
    if (!parsed.success) {
      setError('Enter a phrase name and reusable text.');
      return;
    }
    if (await phrases.save(parsed.data, editing)) {
      setPhraseTitle('');
      setPhraseText('');
      setEditing(undefined);
      setNotice('Reusable phrase saved.');
      setError(null);
    }
  }
  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-[var(--color-line)] bg-white"
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
        Quick corrections &amp; saved phrases{' '}
        <span className="font-normal text-[var(--color-ink-2)]">(Ctrl/⌘ + Shift + K)</span>
      </summary>
      <div className="space-y-4 border-t border-[var(--color-line)] p-4">
        <label className="block text-sm">
          Section
          <select
            className={inputClass}
            value={field}
            onChange={(event) => {
              setField(event.target.value as ScribeNarrativeField);
              setProposal(null);
            }}
          >
            {FIELDS.map((key) => (
              <option key={key} value={key}>
                {SCRIBE_NOTE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Typed correction
          <input
            ref={commandRef}
            className={inputClass}
            value={command}
            maxLength={4_000}
            placeholder={'replace "old wording" with "correct wording"'}
            onChange={(event) => {
              setCommand(event.target.value);
              setProposal(null);
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                preview();
              }
              if (event.key === 'Escape') setProposal(null);
            }}
          />
        </label>
        <p className="text-xs text-[var(--color-ink-2)]">
          Use replace “old text” with “new text” using straight quotes, append: text, or set: text.
          Ctrl/⌘ + Enter previews; applying always requires confirmation.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" variant="secondary" onClick={preview}>
            Preview correction
          </Button>
          {undo && (
            <Button
              type="button"
              className="min-h-11"
              variant="secondary"
              disabled={draft[undo.field] !== undo.change.after}
              onClick={revert}
            >
              Undo last quick correction
            </Button>
          )}
        </div>
        {proposal && (
          <div
            role="region"
            aria-label="Correction preview"
            className="space-y-3 rounded-lg bg-[var(--color-surface-soft)] p-4"
          >
            <h3 className="text-sm font-semibold">
              {proposal.change.description}: {SCRIBE_NOTE_LABELS[proposal.field]}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold">Before</p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {proposal.change.before || 'Empty section'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold">After</p>
                <p className="whitespace-pre-wrap break-words text-sm">{proposal.change.after}</p>
              </div>
            </div>
            {draft[proposal.field] !== proposal.change.before && (
              <p role="alert" className="text-sm">
                The section changed. Preview again before applying.
              </p>
            )}
            <Button
              type="button"
              className="min-h-11"
              disabled={draft[proposal.field] !== proposal.change.before}
              onClick={apply}
            >
              Confirm correction
            </Button>
            <Button
              type="button"
              className="min-h-11"
              variant="ghost"
              onClick={() => setProposal(null)}
            >
              Cancel preview
            </Button>
          </div>
        )}
        <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
          <h3 className="text-sm font-semibold">Saved phrases</h3>
          <ul className="space-y-2">
            {phrases.records
              .filter((record) => record.body.type === 'phrase')
              .map((record) => {
                if (record.body.type !== 'phrase') return null;
                const phrase = record.body;
                return (
                  <li key={record.id} className="rounded-lg border border-[var(--color-line)] p-3">
                    <p className="text-sm font-medium">
                      {phrase.title} · {SCRIBE_NOTE_LABELS[phrase.field]}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-ink-2)]">
                      {phrase.text}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => {
                          setProposal({
                            field: phrase.field,
                            change: {
                              before: draft[phrase.field],
                              after: [draft[phrase.field].trim(), phrase.text]
                                .filter(Boolean)
                                .join('\n'),
                              description: 'Insert saved phrase',
                            },
                          });
                          setError(null);
                        }}
                      >
                        Preview insertion
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11"
                        disabled={phrases.busy}
                        onClick={() => {
                          setPhraseTitle(phrase.title);
                          setPhraseText(phrase.text);
                          setField(phrase.field);
                          setEditing(record);
                        }}
                      >
                        Edit phrase
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11"
                        disabled={phrases.busy}
                        onClick={() => setRemoving(record)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
          </ul>
          {phrases.loaded && !phrases.records.some((record) => record.body.type === 'phrase') && (
            <p className="text-sm text-[var(--color-ink-2)]">
              Save reusable wording below; it is never inserted automatically.
            </p>
          )}
          <label className="block text-sm">
            Phrase name
            <input
              className={inputClass}
              value={phraseTitle}
              maxLength={80}
              onChange={(event) => setPhraseTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Reusable wording
            <textarea
              className={inputClass}
              value={phraseText}
              rows={3}
              maxLength={4_000}
              onChange={(event) => setPhraseText(event.target.value)}
            />
          </label>
          <p className="text-xs text-[var(--color-ink-2)]">
            Saved for the selected section. Use general wording without patient identifiers or
            visit-specific findings.
          </p>
          <Button
            type="button"
            className="min-h-11"
            variant="secondary"
            disabled={phrases.busy}
            onClick={() => void savePhrase()}
          >
            {editing ? 'Save phrase changes' : 'Save reusable phrase'}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setEditing(undefined);
                setPhraseTitle('');
                setPhraseText('');
              }}
            >
              Cancel editing phrase
            </Button>
          )}
          {removing && (
            <div role="alert" className="text-sm">
              <p>Delete saved phrase “{removing.body.title}”?</p>
              <Button
                type="button"
                className="min-h-11"
                disabled={phrases.busy}
                onClick={() =>
                  void phrases.remove(removing).then((ok) => {
                    if (ok) setRemoving(null);
                  })
                }
              >
                Delete phrase
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setRemoving(null)}
              >
                Keep phrase
              </Button>
            </div>
          )}
        </div>
        {(error || phrases.error) && (
          <p role="alert" className="text-sm text-[var(--color-warn)]">
            {error ?? phrases.error}
          </p>
        )}
        {phrases.error && (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => void phrases.reload()}
          >
            Reload phrases
          </Button>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
