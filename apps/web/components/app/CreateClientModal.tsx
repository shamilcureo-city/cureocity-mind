'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { FieldError } from '../ui/Field';
import { ClientFields } from './ClientFields';
import { readApiError } from './record-types';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { subjectNounFor } from '@/lib/vertical';
import {
  buildCreateClientBody,
  EMPTY_CLIENT_DRAFT,
  isClientDraftReady,
  type ClientDraft,
} from '@/lib/client-draft';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (clientId: string) => void;
  /// Sprint DV2 — controls vocabulary (client vs patient), the
  /// post-create redirect (/app/clients vs /app/patients), and whether
  /// the therapy "preferred modality" field shows. Defaults THERAPIST.
  vertical?: 'THERAPIST' | 'DOCTOR';
}

/**
 * Create a client from the roster page — the modal shell only.
 *
 * The fields, the readiness rule and the request body are shared with the
 * Record screen's "+ New client" (`ClientFields` + `lib/client-draft.ts`). The
 * two had drifted into different forms with different consent rules; a
 * therapist met whichever one their route happened to reach.
 *
 * Consents (DPDP): AUDIO_RECORDING, AI_NOTE_GENERATION and
 * CROSS_BORDER_PROCESSING are all required — /sessions/[id]/start refuses a
 * session whose snapshot lacks the last one — and DATA_RETENTION_EXTENDED is
 * opt-in. All are recorded as captured IN_PERSON at script v1.
 *
 * On success, navigates to the new client's detail page so the therapist can
 * immediately start a session or record a workflow.
 */
export function CreateClientModal({ open, onClose, onCreated, vertical = 'THERAPIST' }: Props) {
  const router = useRouter();
  const isDoctor = vertical === 'DOCTOR';
  const noun = subjectNounFor(vertical).singular;
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_CLIENT_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, dialogRef, onClose);
  const ready = isClientDraftReady(draft);

  if (!open) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildCreateClientBody(draft)),
      });
      if (!res.ok) throw new Error(await readApiError(res, `Create ${noun} failed`));
      const created = (await res.json()) as { id: string };
      onCreated?.(created.id);
      router.push(`/app/${isDoctor ? 'patients' : 'clients'}/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-7">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">{isDoctor ? 'New patient' : 'New client'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            cancel
          </button>
        </header>

        <form onSubmit={onSubmit} className="mt-5 space-y-6">
          <ClientFields
            value={draft}
            onChange={setDraft}
            isDoctor={isDoctor}
            idPrefix="cc"
            autoFocusName
          />

          <FieldError message={error} />

          <div className="flex justify-end">
            <Button type="submit" disabled={!ready || submitting}>
              {submitting ? 'Creating…' : isDoctor ? 'Create patient' : 'Create client'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
