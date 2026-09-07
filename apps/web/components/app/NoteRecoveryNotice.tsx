'use client';

import { useEffect, useState } from 'react';
import type { RecoveryRead } from '../../lib/note-edit-recovery-client';
import { Button } from '../ui/Button';
export type NoteRecoveryStatus = 'loading' | 'none' | 'available' | 'error';

/** Read only: reopening the editor performs version-checked recovery hydration. */
export function NoteRecoveryNotice({
  sessionId,
  draftUpdatedAt,
  onResume,
  onStatusChange,
}: {
  sessionId: string;
  draftUpdatedAt: string;
  onResume: () => void;
  onStatusChange?: (status: NoteRecoveryStatus) => void;
}) {
  const [status, setStatus] = useState<NoteRecoveryStatus>('loading');
  useEffect(() => {
    const abort = new AbortController();
    setStatus('loading');
    onStatusChange?.('loading');
    void fetch(`/api/v1/sessions/${sessionId}/note-edit-recovery`, {
      cache: 'no-store',
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Recovery unavailable');
        const body = (await response.json()) as RecoveryRead;
        if (!abort.signal.aborted) {
          const next = body.recovery ? 'available' : 'none';
          setStatus(next);
          onStatusChange?.(next);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setStatus('error');
          onStatusChange?.('error');
        }
      });
    return () => abort.abort();
  }, [sessionId, draftUpdatedAt, onStatusChange]);
  if (status === 'none') return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
      <p role="status" className="max-w-prose text-sm text-[var(--color-ink-2)]">
        {status === 'loading'
          ? 'Checking for saved edits…'
          : status === 'available'
            ? 'There are saved edits to review. They have not been applied to this note.'
            : 'Saved edits could not be checked. Open the editor to retry before signing.'}
      </p>
      {status !== 'loading' && (
        <Button variant="secondary" onClick={onResume}>
          {status === 'available' ? 'Resume saved edits' : 'Check saved edits'}
        </Button>
      )}
    </div>
  );
}
