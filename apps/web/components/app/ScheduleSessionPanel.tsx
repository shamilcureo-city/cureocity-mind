'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BillingEntitlement } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Select, FieldError } from '../ui/Field';
import { UpgradeModal } from './UpgradeModal';
import { CreateClientModal } from './CreateClientModal';
import {
  addCreatedClientOption,
  visibleScheduleClients,
  scheduleSelectionAfterSearch,
  requireScheduleClient,
  readScheduleReceipt,
  scheduleTriggerDisabled,
  type ScheduleReceipt,
} from '@/lib/schedule-client-options';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';
import { useMindCloseoutTaskStatus } from '@/lib/mind-closeout-task-status';
import { formatIstDateTime } from '@/lib/ist';

export interface ClientOption {
  id: string;
  fullName: string;
  preferredModality: string | null;
}

interface Props {
  clients: ClientOption[];
  initialClientId?: string;
  initialDate?: string;
  initialTime?: string;
  closeoutMode?: boolean;
  sourceSessionId?: string;
  followUpState?: 'PENDING' | 'COMPLETE' | 'SKIPPED';
  followUpSession?: { id: string; scheduledAt: string } | null;
  triggerLabelOverride?: string;
  canSkipFollowUp?: boolean;
}

/**
 * Sprint 45 — schedule a future session straight from the Today
 * screen. Opens an inline modal; on submit posts to the existing
 * /api/v1/sessions route with a future scheduledAt (the same route
 * Record uses for walk-ins, just with a non-now time). The
 * session-defaults cascade still picks modality + kind.
 *
 * Booking flow without a new entity — Session.scheduledAt is the
 * calendar. The future Booking model (public lead inbox) lives in
 * Sprint 49's scope.
 */
export function ScheduleSessionPanel({
  clients,
  initialClientId,
  initialDate,
  initialTime,
  closeoutMode = false,
  sourceSessionId,
  followUpState = 'PENDING',
  followUpSession = null,
  triggerLabelOverride,
  canSkipFollowUp = true,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'scheduled' | 'skipped' | null>(
    followUpState === 'COMPLETE' ? 'scheduled' : followUpState === 'SKIPPED' ? 'skipped' : null,
  );
  const [receipt, setReceipt] = useState(followUpSession);
  const [unconfirmedBooking, setUnconfirmedBooking] = useState(false);
  const triggerLabel =
    triggerLabelOverride ??
    (outcome === 'scheduled'
      ? closeoutMode
        ? 'Follow-up scheduled'
        : 'Schedule another session'
      : closeoutMode
        ? 'Schedule next session'
        : 'Schedule session');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setOpen(true)}
          disabled={scheduleTriggerDisabled(closeoutMode, outcome)}
        >
          {unconfirmedBooking
            ? 'Review unconfirmed booking'
            : outcome === 'skipped'
              ? 'Change follow-up'
              : triggerLabel}
        </Button>
        {outcome === 'skipped' && (
          <span className="text-xs text-[var(--color-ink-3)]">Follow-up intentionally skipped</span>
        )}
      </div>
      {(receipt ?? followUpSession) && (
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="status">
          Booked for {formatIstDateTime(new Date((receipt ?? followUpSession)!.scheduledAt))}.{' '}
          <Link
            href={`/app/sessions/${(receipt ?? followUpSession)!.id}`}
            className="text-[var(--color-accent)] underline"
          >
            View appointment
          </Link>
        </p>
      )}
      {unconfirmedBooking && !open && (
        <p className="mt-2 text-sm text-[var(--color-warn)]" role="status">
          The booking could not be confirmed. Its form is kept in this page. Check{' '}
          <Link href="/app/today" className="underline" target="_blank" rel="noopener noreferrer">
            Today in a new tab
          </Link>{' '}
          before booking again.
        </p>
      )}
      {(open || unconfirmedBooking) && (
        <ScheduleModal
          open={open}
          onUnconfirmedBookingChange={setUnconfirmedBooking}
          clients={clients}
          initialClientId={initialClientId}
          initialDate={initialDate}
          initialTime={initialTime}
          closeoutMode={closeoutMode}
          sourceSessionId={sourceSessionId}
          canSkipFollowUp={canSkipFollowUp}
          onSkip={async () => {
            if (!canSkipFollowUp)
              throw new Error('Follow-up decisions are not available for this account.');
            if (!sourceSessionId)
              throw new Error('This session could not be identified. Refresh and try again.');
            const res = await fetch(`/api/v1/sessions/${sourceSessionId}/mind-closeout`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ step: 'followUp', outcome: 'SKIPPED' }),
              signal: AbortSignal.timeout(15_000),
            });
            const body = (await res.json().catch(() => null)) as {
              error?: string;
              sessionId?: string;
              followUpSkippedAt?: string;
              followUpSessionId?: string | null;
            } | null;
            if (
              !res.ok ||
              body?.sessionId !== sourceSessionId ||
              body.followUpSessionId ||
              typeof body.followUpSkippedAt !== 'string' ||
              !Number.isFinite(Date.parse(body.followUpSkippedAt))
            ) {
              throw new Error(
                body?.error ??
                  'The follow-up decision could not be confirmed. Check its saved state before trying again.',
              );
            }
            setOutcome('skipped');
            setOpen(false);
            router.refresh();
          }}
          onClose={() => setOpen(false)}
          onScheduled={(saved) => {
            setReceipt(saved);
            setUnconfirmedBooking(false);
            setOutcome('scheduled');
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ScheduleModal({
  open,
  onUnconfirmedBookingChange,
  clients,
  initialClientId,
  initialDate,
  initialTime,
  closeoutMode,
  sourceSessionId,
  canSkipFollowUp,
  onSkip,
  onClose,
  onScheduled,
}: {
  open: boolean;
  onUnconfirmedBookingChange: (value: boolean) => void;
  clients: ClientOption[];
  initialClientId?: string;
  initialDate?: string;
  initialTime?: string;
  closeoutMode: boolean;
  sourceSessionId?: string;
  canSkipFollowUp: boolean;
  onSkip: () => Promise<void>;
  onClose: () => void;
  onScheduled: (receipt: ScheduleReceipt) => void;
}) {
  const tomorrow = useMemo(() => seedTomorrow(), []);
  const [clientOptions, setClientOptions] = useState(clients);
  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [creatingClient, setCreatingClient] = useState(false);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(initialDate ?? tomorrow.date);
  const [time, setTime] = useState(initialTime ?? '10:00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedBooking, setUnconfirmedBooking] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialDraft = useRef({ clientId, date, time });
  const busyRef = useRef(false);
  const dirty =
    clientId !== initialDraft.current.clientId ||
    date !== initialDraft.current.date ||
    time !== initialDraft.current.time;
  useMindCloseoutTaskStatus({
    dirty,
    busy: submitting,
    needsAttention: !!error,
    uncertain: unconfirmedBooking && !submitting,
  });
  useEffect(() => {
    onUnconfirmedBookingChange(unconfirmedBooking);
  }, [unconfirmedBooking, onUnconfirmedBookingChange]);
  useUnsavedWorkGuard(
    dirty || unconfirmedBooking,
    'This appointment has unsaved changes. Leave without saving them?',
    submitting,
  );
  function requestClose() {
    if (busyRef.current) return;
    // Uncertain attempts stay mounted with all form values. Reopening only reviews them.
    if (unconfirmedBooking) {
      onClose();
      return;
    }
    if (dirty && !window.confirm('Discard the unsaved appointment changes?')) return;
    onClose();
  }
  // Sprint 53 — trial cap modal trigger; Sprint 56 — paid-cap variant too.
  const [upgradePrompt, setUpgradePrompt] = useState<{
    variant: 'TRIAL_CAP' | 'PLAN_CAP';
    entitlement: BillingEntitlement;
  } | null>(null);

  const filtered = useMemo(
    () => visibleScheduleClients(clientOptions, query, clientId),
    [clientOptions, query, clientId],
  );
  const fixedClient = closeoutMode ? clients.find((client) => client.id === initialClientId) : null;
  useModalA11y(
    open && !creatingClient && !upgradePrompt,
    dialogRef,
    submitting ? undefined : requestClose,
  );

  async function skipFollowUp() {
    if (!canSkipFollowUp || busyRef.current || unconfirmedBooking) return;
    if (dirty && !window.confirm('Record no follow-up and discard this unsaved appointment?'))
      return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSkip();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the follow-up decision.');
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current || unconfirmedBooking) return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      requireScheduleClient(
        closeoutMode ? clients : filtered,
        clientId,
        closeoutMode ? (initialClientId ?? '') : undefined,
      );
      const scheduledAt = combineToIso(date, time);
      if (!scheduledAt) throw new Error('Pick a valid date and time.');
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        throw new Error('Follow-up must be scheduled in the future.');
      }
      setUnconfirmedBooking(true);
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, scheduledAt, sourceSessionId }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 408)
          setUnconfirmedBooking(false);
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          entitlement?: BillingEntitlement;
        };
        if (
          res.status === 402 &&
          (body.code === 'TRIAL_CAP_REACHED' || body.code === 'PLAN_CAP_REACHED') &&
          body.entitlement
        ) {
          setUpgradePrompt({
            variant: body.code === 'TRIAL_CAP_REACHED' ? 'TRIAL_CAP' : 'PLAN_CAP',
            entitlement: body.entitlement,
          });
          return;
        }
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const saved = readScheduleReceipt(await res.json().catch(() => null), clientId);
      if (!saved)
        throw new Error(
          'The booking receipt could not be verified. Check Today before booking again; your form is kept here.',
        );
      setUnconfirmedBooking(false);
      onScheduled(saved);
    } catch (e) {
      setError(
        e instanceof Error && !['TimeoutError', 'AbortError', 'TypeError'].includes(e.name)
          ? e.message
          : 'The appointment request could not be confirmed. Your details are still here.',
      );
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      hidden={!open}
      style={open ? undefined : { display: 'none' }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-title"
    >
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="schedule-title" className="font-serif text-xl">
            {closeoutMode ? 'Schedule next session' : 'Schedule session'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            Cancel
          </button>
        </header>
        {closeoutMode && (
          <p className="mb-4 rounded-xl bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-2)]">
            Suggested cadence: one week at the same time. Edit the date or time below if another
            cadence fits better.
          </p>
        )}
        {closeoutMode && !fixedClient ? (
          <p role="alert">The client for this session is unavailable. Refresh before scheduling.</p>
        ) : clientOptions.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4">
            <p className="text-sm text-[var(--color-ink-2)]">
              No active clients yet. Add a client here, then schedule without leaving Today.
            </p>
            <Button className="mt-3" type="button" onClick={() => setCreatingClient(true)}>
              Add a client
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {closeoutMode ? (
              <p className="rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm">
                Follow-up for <strong>{fixedClient!.fullName}</strong>
              </p>
            ) : (
              <div>
                <Label htmlFor="sched-search" hint="search by name">
                  Client
                </Label>
                <Input
                  id="sched-search"
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setClientId(
                      scheduleSelectionAfterSearch(clientOptions, e.target.value, clientId),
                    );
                  }}
                  placeholder="Search…"
                />
                <Select
                  className="mt-2"
                  aria-label="Pick a client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                >
                  <option value="">
                    {filtered.length === 0 ? 'No matches' : 'Choose a client'}
                  </option>
                  {filtered.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                      {c.preferredModality ? ` · ${c.preferredModality}` : ''}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => setCreatingClient(true)}
                  className="mt-2 text-xs font-medium text-[var(--color-accent)] hover:underline"
                >
                  + Add a client
                </button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sched-date">Date</Label>
                <Input
                  id="sched-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="sched-time">Time (IST)</Label>
                <Input
                  id="sched-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
            </div>
            <FieldError message={error} />
            {unconfirmedBooking && !submitting && (
              <p role="alert" className="text-sm text-[var(--color-warn)]">
                Check{' '}
                <Link
                  href="/app/today"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Today in a new tab
                </Link>{' '}
                before booking again. The previous request may have been saved. Your note and
                agreements are unchanged.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-line-soft)] pt-4">
              {closeoutMode && canSkipFollowUp && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void skipFollowUp()}
                  disabled={submitting || unconfirmedBooking}
                >
                  Skip follow-up
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={requestClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || unconfirmedBooking || !clientId}>
                {submitting ? 'Scheduling…' : 'Schedule'}
              </Button>
            </div>
          </form>
        )}
      </Card>
      {upgradePrompt && (
        <UpgradeModal
          open={true}
          onClose={() => setUpgradePrompt(null)}
          variant={upgradePrompt.variant}
          entitlement={upgradePrompt.entitlement}
        />
      )}
      <CreateClientModal
        open={creatingClient}
        onClose={() => setCreatingClient(false)}
        redirectOnCreated={false}
        vertical="THERAPIST"
        onCreated={(created) => {
          setClientOptions((current) => addCreatedClientOption(current, created));
          setClientId(created.id);
          setQuery('');
          setCreatingClient(false);
        }}
      />
    </div>
  );
}

// IST helpers — naive date/time inputs are treated as IST clock-time.
const IST_OFFSET_MIN = 5 * 60 + 30;

function seedTomorrow(): { date: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  return { date: ist.toISOString().slice(0, 10) };
}

function combineToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map((p) => Number.parseInt(p, 10));
  const [hh, mm] = time.split(':').map((p) => Number.parseInt(p, 10));
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  const utcMs = Date.UTC(y, (m ?? 1) - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}
