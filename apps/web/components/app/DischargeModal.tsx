'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FieldError, Label, Select, Textarea } from '../ui/Field';

interface Props {
  open: boolean;
  clientId: string;
  clientName: string;
  /** True when ≥1 instrument verdict exists — we nudge sharing a report. */
  canShareReport: boolean;
  onClose: () => void;
}

type DischargeStatus = 'DISCHARGED' | 'TRANSFERRED';

/**
 * Sprint 20 Phase 3 — close a client's treatment episode.
 *
 * Captures the terminal status + a required reason + an optional
 * outcome note, POSTs to /clients/[id]/discharge, then refreshes the
 * page so the Journey hub flips to its terminal state. Discharge is
 * reversible by recording a new session (which reopens a fresh
 * episode), so the copy frames it as "close this episode", not
 * "delete the client".
 */
export function DischargeModal({ open, clientId, clientName, canShareReport, onClose }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<DischargeStatus>('DISCHARGED');
  const [reason, setReason] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/discharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          reason: reason.trim(),
          outcomeNote: outcomeNote.trim() ? outcomeNote.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Discharge failed (${res.status})`);
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,27,42,0.45)] p-4">
      <Card className="w-full max-w-lg p-7">
        <header className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Close care episode
          </p>
          <h2 className="mt-1 font-serif text-2xl">Discharge {clientName}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            This closes the current episode of care. You can reopen it later by recording a new
            session.
          </p>
        </header>

        <div className="space-y-4">
          <div>
            <Label htmlFor="discharge-status">Outcome</Label>
            <Select
              id="discharge-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as DischargeStatus)}
            >
              <option value="DISCHARGED">Discharged — treatment complete</option>
              <option value="TRANSFERRED">Transferred — referred elsewhere</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="discharge-reason">Reason</Label>
            <Textarea
              id="discharge-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Goals met; PHQ-9 in remission across the last three sessions."
            />
          </div>

          <div>
            <Label htmlFor="discharge-outcome" hint="optional">
              Outcome note
            </Label>
            <Textarea
              id="discharge-outcome"
              rows={3}
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              placeholder="A short summary you may want to surface in the client's final report."
            />
          </div>

          {canShareReport && (
            <p className="rounded-xl bg-[var(--color-accent-soft)] px-4 py-3 text-xs text-[var(--color-ink-2)]">
              After discharging, use <strong>Share progress report</strong> on the journey panel to
              send {clientName} a final record of their progress.
            </p>
          )}

          <FieldError message={error} />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || reason.trim().length === 0}>
            {submitting ? 'Closing…' : 'Close episode'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
