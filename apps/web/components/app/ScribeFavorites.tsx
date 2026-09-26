'use client';

import { useEffect, useRef, useState } from 'react';
import type { RxPadDraft, RxPadPatchOp } from '@cureocity/contracts';
import {
  ScribeShortcutSchema,
  type ScribeShortcut,
  type ScribeShortcutRecord,
  type ScribeFavoriteItem,
  shortcutRequiresPrescribing,
} from '@/lib/scribe-personalization-contracts';
import {
  scribeFavoriteSetFromPad,
  scribeShortcutDetail,
  scribeShortcutOps,
} from '@/lib/scribe-shortcuts';
import { useScribeShortcuts } from '@/lib/use-scribe-personalization';
import { Button } from '../ui/Button';

const inputClass =
  'min-h-11 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm';

export function ScribeFavorites({
  pad,
  seed,
  disabled,
  onApply,
}: {
  pad: RxPadDraft | null;
  seed: ScribeShortcut | null;
  disabled: boolean;
  onApply: (ops: RxPadPatchOp[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const favorites = useScribeShortcuts(open);
  const [draft, setDraft] = useState<ScribeShortcut | null>(null);
  const [editing, setEditing] = useState<ScribeShortcutRecord | undefined>();
  const [preview, setPreview] = useState<{ shortcut: ScribeShortcut; fingerprint: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<ScribeShortcutRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (seed) {
      setDraft(seed);
      setEditing(undefined);
      setOpen(true);
    }
  }, [seed]);
  const busy = disabled || favorites.busy || applying;
  const fingerprint = JSON.stringify(pad);
  function review(shortcut: ScribeShortcut) {
    setError(null);
    setNotice(null);
    try {
      scribeShortcutOps(shortcut, pad);
      setPreview({ shortcut, fingerprint });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function apply() {
    if (!preview || busy || applyingRef.current) return;
    if (preview.fingerprint !== fingerprint) {
      setError('The plan changed. Preview this favorite again.');
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    try {
      if (await onApply(scribeShortcutOps(preview.shortcut, pad))) {
        setPreview(null);
        setNotice('Added to this draft. Review and confirm medicine rows before signing.');
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function save() {
    const parsed = ScribeShortcutSchema.safeParse(draft);
    if (!parsed.success) {
      setError('Check the favorite name and its clinical details.');
      return;
    }
    if (await favorites.save(parsed.data, editing)) {
      setDraft(null);
      setEditing(undefined);
      setNotice('Favorite saved for your future consultations.');
      setError(null);
    }
  }
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mb-5 rounded-xl border border-[var(--color-line)] bg-white"
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
        Saved prescription, investigation &amp; advice favorites
      </summary>
      {open && (
        <div className="space-y-4 border-t border-[var(--color-line)] p-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Preview a favorite for this patient before adding it. Saved medicine details still need
            individual review.
          </p>
          {!favorites.loaded && !favorites.error && (
            <p role="status" className="text-sm">
              Loading your favorites…
            </p>
          )}
          {favorites.loaded &&
            favorites.records.filter((item) => item.body.type !== 'phrase').length === 0 && (
              <p className="text-sm text-[var(--color-ink-2)]">
                No favorites yet. Save a plan row below or create one here.
              </p>
            )}
          <ul className="space-y-2">
            {favorites.records
              .filter((item) => item.body.type !== 'phrase')
              .map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{record.body.title}</p>
                    <p className="break-words text-sm text-[var(--color-ink-2)]">
                      {scribeShortcutDetail(record.body)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => review(record.body)}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => {
                      setDraft(record.body);
                      setEditing(record);
                    }}
                  >
                    Edit favorite
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => setRemoving(record)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy || scribeFavoriteSetFromPad(pad).items.length === 0}
              onClick={() => {
                setDraft(scribeFavoriteSetFromPad(pad));
                setEditing(undefined);
              }}
            >
              Save this draft as a set
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setDraft({ type: 'medication', title: '', med: { drug: '' } });
                setEditing(undefined);
              }}
            >
              New medicine favorite
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setDraft({ type: 'investigation', title: '', name: '' });
                setEditing(undefined);
              }}
            >
              New investigation favorite
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setDraft({ type: 'advice', title: '', text: '' });
                setEditing(undefined);
              }}
            >
              New advice favorite
            </Button>
          </div>
          {draft && (
            <fieldset className="space-y-3 rounded-lg bg-[var(--color-surface-soft)] p-4">
              <legend className="text-sm font-semibold">
                {editing ? 'Edit saved favorite' : 'Save reusable favorite'}
              </legend>
              <label className="block text-sm">
                Favorite name
                <input
                  className={inputClass}
                  value={draft.title}
                  maxLength={80}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              {draft.type === 'medication' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      'drug',
                      'strength',
                      'dose',
                      'frequency',
                      'timing',
                      'route',
                      'durationDays',
                    ] as const
                  ).map((key) => (
                    <label key={key} className="block text-sm">
                      {
                        {
                          drug: 'Medicine',
                          strength: 'Strength',
                          dose: 'Dose',
                          frequency: 'Frequency',
                          timing: 'Timing',
                          route: 'Route',
                          durationDays: 'Duration in days',
                        }[key]
                      }
                      <input
                        className={inputClass}
                        value={draft.med[key] ?? ''}
                        type={key === 'durationDays' ? 'number' : 'text'}
                        min={key === 'durationDays' ? 1 : undefined}
                        max={key === 'durationDays' ? 365 : undefined}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            med: {
                              ...draft.med,
                              [key]:
                                key === 'durationDays'
                                  ? event.target.value
                                    ? Number(event.target.value)
                                    : undefined
                                  : event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {draft.type === 'investigation' && (
                <>
                  <label className="block text-sm">
                    Investigation
                    <input
                      className={inputClass}
                      value={draft.name}
                      maxLength={200}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    Reusable rationale (optional)
                    <input
                      className={inputClass}
                      value={draft.rationale ?? ''}
                      maxLength={300}
                      onChange={(event) => setDraft({ ...draft, rationale: event.target.value })}
                    />
                  </label>
                </>
              )}
              {draft.type === 'advice' && (
                <label className="block text-sm">
                  Reusable advice
                  <textarea
                    className={inputClass}
                    value={draft.text}
                    maxLength={300}
                    onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                  />
                </label>
              )}
              {draft.type === 'set' && (
                <div className="space-y-3">
                  <p className="text-sm">
                    Review this reusable set ({draft.items.length}/5 items). Only confirmed
                    medicines, investigations and advice are included. Remove any patient-specific
                    wording. Nothing is added to another encounter until you preview and confirm it
                    there.
                  </p>
                  {draft.items.length > 5 && (
                    <p role="alert" className="text-sm text-[var(--color-warn)]">
                      Keep up to 5 items so the entire set is added together.
                    </p>
                  )}
                  <ol className="space-y-3">
                    {draft.items.map((item, index) => (
                      <li
                        key={index}
                        className="rounded-lg border border-[var(--color-line)] bg-white p-3"
                      >
                        <ScribeSetItemEditor
                          item={item}
                          onChange={(next) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((existing, position) =>
                                position === index ? next : existing,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="mt-2 min-h-11"
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              items: draft.items.filter((_item, position) => position !== index),
                            })
                          }
                        >
                          Remove item {index + 1}
                        </Button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="text-xs text-[var(--color-ink-2)]">
                Use general wording. Remove patient identifiers and details specific to this visit.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={
                    busy ||
                    (draft.type === 'set' && (draft.items.length < 1 || draft.items.length > 5))
                  }
                  onClick={() => void save()}
                >
                  Confirm &amp; save favorite
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
              </div>
            </fieldset>
          )}
          {preview && (
            <div
              role="region"
              aria-label="Favorite preview"
              className="space-y-3 rounded-lg border border-[var(--color-line)] p-4"
            >
              <h3 className="font-semibold">
                Add {preview.shortcut.title} to this patient's draft?
              </h3>
              <p className="text-sm">{scribeShortcutDetail(preview.shortcut)}</p>
              {preview.shortcut.type === 'set' && (
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {preview.shortcut.items.map((item, index) => (
                    <li key={index}>{scribeShortcutDetail(item)}</li>
                  ))}
                </ol>
              )}
              {shortcutRequiresPrescribing(preview.shortcut) && (
                <p className="text-sm">
                  Check the drug, dose, duration and patient suitability. It will be added pending
                  confirmation; current interaction warnings are recomputed.
                </p>
              )}
              {preview.fingerprint !== fingerprint && (
                <p role="alert" className="text-sm">
                  The plan changed. Select Preview again.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={busy || preview.fingerprint !== fingerprint}
                  onClick={() => void apply()}
                >
                  Confirm &amp; add to draft
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {removing && (
            <div role="alert" className="space-y-2 text-sm">
              <p>
                Delete the saved favorite “{removing.body.title}”? Existing patient plans stay
                unchanged.
              </p>
              <Button
                type="button"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  void favorites.remove(removing).then((ok) => {
                    if (ok) setRemoving(null);
                  })
                }
              >
                Delete favorite
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setRemoving(null)}
              >
                Keep favorite
              </Button>
            </div>
          )}
          {(error || favorites.error) && (
            <p role="alert" className="text-sm text-[var(--color-warn)]">
              {error ?? favorites.error}
            </p>
          )}
          {favorites.error && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => void favorites.reload()}
            >
              Reload favorites
            </Button>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

function ScribeSetItemEditor({
  item,
  onChange,
}: {
  item: ScribeFavoriteItem;
  onChange: (item: ScribeFavoriteItem) => void;
}) {
  if (item.type === 'medication')
    return (
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="text-sm font-semibold">Medicine</legend>
        {(
          ['drug', 'strength', 'dose', 'frequency', 'timing', 'route', 'durationDays'] as const
        ).map((key) => (
          <label key={key} className="text-sm">
            {
              {
                drug: 'Medicine name',
                strength: 'Strength',
                dose: 'Dose',
                frequency: 'Frequency',
                timing: 'Timing',
                route: 'Route',
                durationDays: 'Duration in days',
              }[key]
            }
            <input
              className={inputClass}
              value={item.med[key] ?? ''}
              type={key === 'durationDays' ? 'number' : 'text'}
              min={key === 'durationDays' ? 1 : undefined}
              max={key === 'durationDays' ? 365 : undefined}
              onChange={(event) =>
                onChange({
                  ...item,
                  title: key === 'drug' ? event.target.value.slice(0, 80) : item.title,
                  med: {
                    ...item.med,
                    [key]:
                      key === 'durationDays'
                        ? event.target.value
                          ? Number(event.target.value)
                          : undefined
                        : event.target.value,
                  },
                })
              }
            />
          </label>
        ))}
      </fieldset>
    );
  if (item.type === 'investigation')
    return (
      <label className="block text-sm">
        Investigation
        <input
          className={inputClass}
          value={item.name}
          maxLength={200}
          onChange={(event) =>
            onChange({ ...item, title: event.target.value.slice(0, 80), name: event.target.value })
          }
        />
      </label>
    );
  return (
    <label className="block text-sm">
      Advice
      <textarea
        className={inputClass}
        value={item.text}
        maxLength={300}
        onChange={(event) =>
          onChange({ ...item, title: event.target.value.slice(0, 80), text: event.target.value })
        }
      />
    </label>
  );
}
