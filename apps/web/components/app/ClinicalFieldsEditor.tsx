'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { noteEditIsDirty } from '../../lib/canonical-note-edit';
import { useUnsavedWorkGuard } from '../../lib/use-unsaved-work-guard';
import {
  NoteEditRecoveryClient,
  type NoteEditRecoveryTarget,
  type RecoveryClientState,
} from '../../lib/note-edit-recovery-client';

interface Field {
  key: string;
  label: string;
  required?: boolean;
}

/** Recovery is encrypted on the server, separate from the canonical note. No PHI web storage. */
export function ClinicalFieldsEditor({
  initial,
  fields,
  saving,
  error,
  onSave,
  onCancel,
  hasDerivedView,
  recoveryTarget,
}: {
  initial: Record<string, string>;
  fields: readonly Field[];
  saving: boolean;
  error?: string | null;
  onSave: (
    values: Record<string, string>,
    recoveryRevision?: number,
  ) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  hasDerivedView: boolean;
  recoveryTarget?: NoteEditRecoveryTarget;
}) {
  const [values, setValues] = useState(initial);
  const [validation, setValidation] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const client = useRef<NoteEditRecoveryClient | null>(null);
  const [recovery, setRecovery] = useState<RecoveryClientState>({
    status: recoveryTarget ? 'loading' : 'ready',
    message: null,
    savedAt: null,
    restored: false,
    remote: null,
    protected: true,
  });
  const initialJson = JSON.stringify(initial);
  const recoverySession = recoveryTarget?.sessionId;
  const recoveryBase = recoveryTarget?.baseUpdatedAt;
  const recoveryKind = recoveryTarget?.kind;
  useEffect(() => {
    if (!recoverySession || !recoveryBase || !recoveryKind) return;
    const instance = new NoteEditRecoveryClient(
      { sessionId: recoverySession, baseUpdatedAt: recoveryBase, kind: recoveryKind },
      JSON.parse(initialJson) as Record<string, string>,
      setRecovery,
      setValues,
    );
    client.current = instance;
    void instance.load();
    const flush = () => {
      void instance.flush();
    };
    const visible = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visible);
      // Best effort only: the visible status never claims unacknowledged requests are saved.
      void instance.flush();
      instance.dispose();
      if (client.current === instance) client.current = null;
    };
  }, [recoverySession, recoveryBase, recoveryKind, initialJson]);
  const dirty = useMemo(() => noteEditIsDirty(initial, values), [initial, values]);
  const busy = saving || applying || cancelling;
  const unprotected = recoveryTarget ? !recovery.protected : dirty;
  const recoveryBlocked = Boolean(
    recoveryTarget && (recovery.status === 'loading' || !client.current?.isHydrated()),
  );
  const id = useId();
  useUnsavedWorkGuard(
    unprotected,
    recoverySession
      ? 'Your latest edits are not saved for recovery. Leave without them?'
      : 'Your note has unsaved changes. Leave without saving them?',
    busy,
  );

  async function save() {
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (missing) {
      setValidation(`${missing.label} cannot be empty.`);
      setInvalidField(missing.key);
      fieldRefs.current[missing.key]?.focus();
      return;
    }
    setValidation(null);
    setInvalidField(null);
    setApplying(true);
    try {
      if (client.current && !(await client.current.flush())) return;
      client.current?.pause();
      const applied = await onSave(values, client.current?.getRevision());
      if (applied === false) client.current?.resume();
    } catch {
      client.current?.resume();
      setValidation(
        recoveryTarget
          ? 'Your corrections could not be applied. Keep this page open and retry Apply corrections.'
          : 'Your corrections could not be saved. Keep this page open and retry Save note.',
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-5">
      <p role="status" className="text-sm text-[var(--color-ink-2)]">
        {busy
          ? cancelling
            ? 'Discarding edits…'
            : 'Applying corrections…'
          : recoveryTarget
            ? recovery.status === 'loading'
              ? 'Checking for saved edits before you begin…'
              : recovery.status === 'saving' || recovery.status === 'pending'
                ? 'Saving draft edits… Keep this page open until confirmed.'
                : recovery.status === 'saved' && recovery.protected
                  ? 'Draft edits saved securely. Apply corrections to update the note before signing.'
                  : recovery.status === 'error' || recovery.status === 'conflict'
                    ? 'Recovery needs your attention.'
                    : 'Draft edits save automatically. Apply corrections when you finish reviewing.'
            : dirty
              ? 'Unsaved changes — save before leaving this note.'
              : 'Editing the source clinical fields.'}
      </p>
      {recoveryTarget && recovery.restored && (
        <p className="text-sm text-[var(--color-ink-2)]">
          Your saved edits have been restored. Review them before applying.
        </p>
      )}
      {recoveryTarget && recovery.message && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p role="alert" className="max-w-prose text-sm text-amber-950">
            {recovery.message}
          </p>
          {recovery.status === 'error' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (client.current?.isDiscardPending()) {
                  setCancelling(true);
                  try {
                    if (await client.current.discard()) onCancel();
                  } finally {
                    setCancelling(false);
                  }
                } else await client.current?.retry();
              }}
            >
              {client.current?.isDiscardPending()
                ? 'Retry discarding edits'
                : client.current?.isHydrated()
                  ? 'Retry saving edits'
                  : 'Check saved edits again'}
            </Button>
          )}
          {recovery.status === 'conflict' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void client.current?.inspectConflict()}
            >
              Compare saved edits
            </Button>
          )}
        </div>
      )}
      {recoveryTarget && recovery.remote && (
        <details className="rounded-xl border border-[var(--color-line)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Compare saved edits (not applied)
          </summary>
          <div className="mt-4 space-y-4">
            {fields.map((field) => (
              <div key={field.key}>
                <p className="mb-1 text-sm font-semibold">{field.label}</p>
                <p className="whitespace-pre-wrap text-sm">
                  {recovery.remote?.fields[field.key] || '(Empty)'}
                </p>
              </div>
            ))}
          </div>
          {recovery.remote.baseUpdatedAt === recoveryBase && recovery.status === 'conflict' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    'Replace the text in this editor with the server copy? Your current unsaved text will be discarded.',
                  )
                )
                  return;
                setApplying(true);
                try {
                  await client.current?.useServerCopy();
                } finally {
                  setApplying(false);
                }
              }}
            >
              Use saved version
            </Button>
          )}
        </details>
      )}
      {hasDerivedView && (
        <p className="rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-ink-2)]">
          Applying corrections updates the note from these fields. Older AI summaries and evidence
          links are removed so they cannot contradict your changes. Safety flags remain for review.
        </p>
      )}
      <nav aria-label="Jump to a note field" className="flex flex-wrap gap-2">
        {fields.map((field) => (
          <button
            key={field.key}
            type="button"
            onClick={() => fieldRefs.current[field.key]?.focus()}
            className="min-h-10 rounded-full border border-[var(--color-line)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            {field.label}
          </button>
        ))}
      </nav>
      <p className="text-xs text-[var(--color-ink-2)]">
        Required fields are labelled.{' '}
        {recoveryTarget
          ? 'Incomplete edits can still be saved as a draft. Maximum 20,000 characters per field.'
          : 'Save your changes before leaving.'}
      </p>
      {fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`${id}-${field.key}`} className="mb-2 block text-sm font-semibold">
            {field.label}
            {field.required && (
              <span className="ml-2 text-xs font-normal text-[var(--color-ink-2)]">Required</span>
            )}
          </label>
          <textarea
            id={`${id}-${field.key}`}
            ref={(element) => {
              fieldRefs.current[field.key] = element;
            }}
            aria-required={field.required || undefined}
            aria-invalid={invalidField === field.key || undefined}
            aria-describedby={invalidField === field.key ? `${id}-validation` : undefined}
            maxLength={recoveryTarget ? 20_000 : undefined}
            rows={4}
            value={values[field.key] ?? ''}
            disabled={busy || recoveryBlocked}
            onChange={(event) => {
              const next = { ...values, [field.key]: event.target.value };
              setValues(next);
              if (invalidField === field.key) {
                setInvalidField(null);
                setValidation(null);
              }
              client.current?.update(next);
            }}
            className="w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-base leading-relaxed text-[var(--color-ink)]"
          />
        </div>
      ))}
      {(validation ?? error) && (
        <p id={`${id}-validation`} role="alert" className="text-sm text-[var(--color-warn)]">
          {validation ?? error}
        </p>
      )}
      <div className="sticky bottom-16 z-20 flex flex-wrap gap-2 border-t border-[var(--color-line-soft)] bg-white/95 py-4 md:bottom-0">
        <Button
          onClick={() => void save()}
          disabled={
            busy || recoveryBlocked || Boolean(recoveryTarget && recovery.status === 'conflict')
          }
        >
          {busy ? 'Working…' : recoveryTarget ? 'Apply corrections' : 'Save note'}
        </Button>
        {recoveryTarget && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (
                unprotected &&
                !window.confirm(
                  'Close without confirming your latest changes? Only edits still saved on the server will be available.',
                )
              )
                return;
              client.current?.dispose();
              onCancel();
            }}
          >
            Close editor
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy || recoveryBlocked}
          onClick={async () => {
            if (
              (dirty || recovery.restored || recovery.remote) &&
              !window.confirm(
                recoveryTarget
                  ? 'Discard your note changes and their saved recovery copy?'
                  : 'Discard your unsaved note changes?',
              )
            )
              return;
            setCancelling(true);
            try {
              if (client.current && !(await client.current.discard())) return;
              onCancel();
            } finally {
              setCancelling(false);
            }
          }}
        >
          {recoveryTarget ? 'Discard edits' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
