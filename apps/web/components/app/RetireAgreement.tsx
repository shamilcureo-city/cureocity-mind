'use client';

import { useId, useState } from 'react';
import { SessionAgreementDtoSchema, type SessionAgreementDto } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';

export function RetireAgreement({
  agreement,
  disabled,
  onSaved,
}: {
  agreement: SessionAgreementDto;
  disabled?: boolean;
  onSaved: (agreement: SessionAgreementDto) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reviewedRevision, setReviewedRevision] = useState(agreement.revision ?? 0);
  const [reviewedText, setReviewedText] = useState(agreement.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedWorkGuard(
    open,
    'This decision to retire a commitment has not been saved. Leave without saving?',
    busy,
  );
  async function save() {
    if (busy || reviewedRevision !== (agreement.revision ?? 0)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/sessions/${agreement.sessionId}/agreements/${agreement.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'retire',
            expectedRevision: reviewedRevision,
            reason,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = (await response.json().catch(() => null)) as { agreement?: unknown } | null;
      const result = SessionAgreementDtoSchema.safeParse(body?.agreement);
      if (
        !response.ok ||
        !result.success ||
        result.data.id !== agreement.id ||
        !result.data.retiredAt
      )
        throw new Error(
          response.status === 409
            ? 'This commitment changed. Reload its latest wording before retiring it.'
            : 'Retirement was not confirmed. Your reason is still here; retry the same save.',
        );
      onSaved(result.data);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm retirement.');
    } finally {
      setBusy(false);
    }
  }
  if (agreement.retiredAt || agreement.followUp === 'DONE') return null;
  return (
    <div className="mt-2 text-xs">
      {!open ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setReviewedRevision(agreement.revision ?? 0);
            setReviewedText(agreement.text);
            setOpen(true);
          }}
        >
          No longer an active commitment
        </Button>
      ) : (
        <div className="space-y-2 rounded-xl border border-[var(--color-line)] p-3">
          <p>
            Keep this agreement in history, but stop carrying it into preparation. This does not
            mark it done, cancel linked homework, or send anything.
          </p>
          <p className="whitespace-pre-wrap">Commitment reviewed: {reviewedText}</p>
          {reviewedRevision !== (agreement.revision ?? 0) && (
            <p role="alert">
              The wording changed. Keep the commitment active and reopen this decision to review the
              latest version.
            </p>
          )}
          <label htmlFor={id} className="block">
            Why is it no longer active?
          </label>
          <textarea
            id={id}
            value={reason}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border p-2"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                disabled || busy || !reason.trim() || reviewedRevision !== (agreement.revision ?? 0)
              }
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Retire commitment'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Keep active
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
