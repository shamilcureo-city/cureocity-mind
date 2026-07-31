'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError } from '../ui/Field';
import { ClientFields } from './ClientFields';
import { readApiError } from './record-types';
import {
  buildCreateClientBody,
  EMPTY_CLIENT_DRAFT,
  isClientDraftReady,
  type ClientDraft,
} from '@/lib/client-draft';

interface Props {
  onCancel: () => void;
  /** Hands the created client to the shared confirm step. */
  onCreated: (client: { id: string; fullName: string }) => void;
}

/**
 * "+ New client" on the Record screen — the shell only.
 *
 * The fields, the readiness rule and the request body are shared with the
 * Clients page's modal (`ClientFields` + `lib/client-draft.ts`). The two entry
 * points had drifted into different products: this one asked for six fewer
 * things and disagreed about which consents were required, so which form you
 * got depended on where you happened to click. Both now render the same set,
 * quick fields first and the rest behind "More details".
 *
 * It creates ONLY the client, then hands off to `RecordConfirmStrip` — the same
 * confirm step every existing client goes through, which owns session
 * create/reuse, the per-session consent snapshot, the capture choice (live
 * scribe vs record-only) and /start. Submitting used to do all of that inline
 * and drop the therapist straight into the recorder: no moment to check what
 * you typed, and no way for a new client to use the live scribe.
 *
 * Modality still defaults to blank. Intake is *how* you decide it, and
 * pre-filling the therapist's usual approach would be clinically wrong.
 */
export function NewClientForm({ onCancel, onCreated }: Props) {
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_CLIENT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = isClientDraftReady(draft);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCreateClientBody(draft)),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Create client failed'));
      onCreated((await res.json()) as { id: string; fullName: string });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-7">
      <button
        type="button"
        onClick={onCancel}
        className="mb-5 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Back
      </button>

      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
        New client
      </p>
      <h2 className="mt-1 font-serif text-2xl">First session with someone new</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        Just the essentials. Everything else can wait.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <ClientFields value={draft} onChange={setDraft} idPrefix="nc" autoFocusName />

        <FieldError message={error} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-ink-3)]">
            Next you&rsquo;ll confirm how to capture this session.
          </p>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'Adding…' : 'Add client & continue'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
