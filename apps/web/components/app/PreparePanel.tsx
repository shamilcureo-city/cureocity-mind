'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AgreementFollowUp,
  PrepareSummaryV1,
  SessionAgreementDto,
} from '@cureocity/contracts';
import { ActiveAgreementPageSchema, SessionAgreementDtoSchema } from '@cureocity/contracts';
import { AgreementHomework } from './AgreementHomework';
import { RetireAgreement } from './RetireAgreement';
import { Badge } from '../ui/Badge';
import { preparationFreshness } from '@/lib/preparation-freshness';
import { DiagnosisChips, QuestionsChecklist } from './SessionDirection';
import { prepareIntentKey } from '@/lib/prepare-intent';
import {
  AgreementFollowUpConflictError,
  saveAgreementFollowUp,
} from '@/lib/agreement-follow-up-save';
import { useUnsavedWorkGuard } from '@/lib/use-unsaved-work-guard';

/**
 * Sprint 50 — Prepare panel on the Today screen.
 *
 * Expands inside a `TodaySessionCard`. Lazy-fetches the cached pre-
 * session brief + journey signals + homework + open crisis flags so
 * the Today page query stays lean (no N+1 — each card only fetches
 * when expanded).
 *
 * Never triggers a Pass-5 generation on its own; the "Generate fresh
 * brief" button explicitly hits the existing `/pre-session-brief`
 * route, which the therapist sees billed as a Gemini call.
 */

interface Props {
  clientId: string;
  /** Optional initial open state — defaults to closed (fetch on click). */
  defaultOpen?: boolean;
  /** Load safety and a short recap without expanding the full clinical brief. */
  summaryVisible?: boolean;
}

export function PreparePanel({ clientId, defaultOpen = false, summaryVisible = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<PrepareSummaryV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [followUpPending, setFollowUpPending] = useState(false);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const updateFollowUpState = useCallback((pending: boolean, busy: boolean) => {
    setFollowUpPending(pending);
    setFollowUpSaving(busy);
  }, []);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setGenerating(false);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/prepare`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as PrepareSummaryV1 & { error?: string };
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (open || summaryVisible) void load();
    return () => {
      requestRef.current?.abort();
      generationRef.current?.abort();
    };
  }, [open, summaryVisible, load]);

  async function generateFreshBrief() {
    generationRef.current?.abort();
    const controller = new AbortController();
    generationRef.current = controller;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/pre-session-brief?refresh=1`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Re-fetch the summary so the cached-brief block flips to the
      // fresh content.
      await load();
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setGenerating(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
      {summaryVisible && data && (
        <div className="mb-3 space-y-3">
          <PrepareSafety openCrises={data.openCrises} />
          <p className="line-clamp-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
            {data.cachedBrief?.lastSessionRecap || 'No previous session recap is available.'}
          </p>
          <p className="text-xs text-[var(--color-ink-3)]">
            {preparationFreshness(data.briefGeneratedAt, data.briefIsStale).label} · Full context is
            available below.
          </p>
        </div>
      )}
      <button
        type="button"
        disabled={followUpSaving}
        onClick={() => {
          if (
            open &&
            followUpPending &&
            !window.confirm(
              'This follow-up has not been saved. Discard the unsaved choice and close preparation?',
            )
          )
            return;
          setFollowUpPending(false);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        {open ? 'Hide full preparation' : 'Full preparation (optional)'}
      </button>
      {(open || summaryVisible) && (
        <div className="mt-3 space-y-4">
          {loading && !data && (
            <p className="text-sm text-[var(--color-ink-3)]" role="status">
              Loading preparation and safety context…
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)]"
            >
              Preparation and safety context could not be loaded. {error}
              <button
                type="button"
                onClick={() => void load()}
                className="ml-3 font-medium underline"
                disabled={loading}
              >
                Retry preparation
              </button>
            </p>
          )}
          {data && open && (
            <PrepareBody
              data={data}
              onGenerate={generateFreshBrief}
              generating={generating}
              safetyVisible={!summaryVisible}
              onFollowUpPending={updateFollowUpState}
              refreshDisabled={followUpPending || followUpSaving}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PrepareBody({
  data,
  onGenerate,
  generating,
  safetyVisible,
  onFollowUpPending,
  refreshDisabled,
}: {
  data: PrepareSummaryV1;
  onGenerate: () => void | Promise<void>;
  generating: boolean;
  safetyVisible: boolean;
  onFollowUpPending: (pending: boolean, busy: boolean) => void;
  refreshDisabled: boolean;
}) {
  const { cachedBrief, briefIsStale, journey, homework, openCrises } = data;
  const freshness = preparationFreshness(data.briefGeneratedAt, briefIsStale);

  return (
    <div className="space-y-4 text-sm">
      {safetyVisible && <PrepareSafety openCrises={openCrises} />}

      <section aria-labelledby="prepare-change">
        <p
          id="prepare-change"
          className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
        >
          What changed
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-2)]">
          {cachedBrief?.lastSessionRecap || 'No prior session recap yet.'}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          {journey.instrumentChanges.map((change) => (
            <span
              key={change.instrumentKey}
              className="rounded-full bg-[var(--color-surface)] px-3 py-0.5 text-xs text-[var(--color-ink-2)]"
            >
              {instrumentLabel(change.instrumentKey)} {change.baselineScore}→{change.latestScore} ·{' '}
              {verdictChip(change.verdict)}
            </span>
          ))}
          {journey.instrumentChanges.length === 0 && (
            <span className="text-xs text-[var(--color-ink-3)]">
              No repeated outcome measure yet.
            </span>
          )}
        </div>
      </section>

      <section aria-labelledby="prepare-decisions">
        <p
          id="prepare-decisions"
          className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
        >
          Decisions already made
        </p>
        <div className="mt-2 space-y-3">
          {(data.activeAgreements ?? data.lastAgreements).length > 0 && (
            <AgreementsThread
              key={data.clientId}
              clientId={data.clientId}
              agreements={data.activeAgreements ?? data.lastAgreements}
              total={data.activeAgreementCount ?? data.lastAgreements.length}
              initialCursor={data.activeAgreementsNextCursor ?? null}
              onPendingChange={onFollowUpPending}
            />
          )}
          {data.formulationSnapshot && (
            <div className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
              <p className="text-xs font-medium">Formulation v{data.formulationSnapshot.version}</p>
              {data.formulationSnapshot.headline && (
                <p className="mt-1 text-xs text-[var(--color-ink-2)]">
                  {data.formulationSnapshot.headline}
                </p>
              )}
              {data.formulationSnapshot.cycleLine && (
                <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">
                  {data.formulationSnapshot.cycleLine}
                </p>
              )}
            </div>
          )}
          <DiagnosisChips diagnoses={data.confirmedDiagnoses} />
          <div className="flex flex-wrap items-baseline gap-2">
            <Badge tone="muted">
              Suggested care stage: {journey.stage.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            {journey.activePlan && (
              <span className="text-xs text-[var(--color-ink-3)]">
                Plan v{journey.activePlan.version} · {journey.activePlan.goalsAchieved}/
                {journey.activePlan.goalsTotal} goals
              </span>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="prepare-questions">
        <p
          id="prepare-questions"
          className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
        >
          Questions to carry
        </p>
        <QuestionsChecklist questions={data.carriedQuestions} />
      </section>

      <section aria-labelledby="prepare-homework">
        <p
          id="prepare-homework"
          className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
        >
          Homework follow-up
        </p>
        {homework.length > 0 ? (
          <ul className="mt-1 space-y-1 text-xs text-[var(--color-ink-2)]">
            {homework.slice(0, 3).map((item) => (
              <li key={item.id} className="flex items-baseline gap-2">
                <Badge tone={homeworkTone(item.status)}>{item.status.toLowerCase()}</Badge>
                <span className="truncate">{item.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">No recent homework to follow up.</p>
        )}
      </section>

      <section aria-labelledby="prepare-direction">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p
            id="prepare-direction"
            className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
          >
            Suggested direction
          </p>
          <div className="flex items-center gap-2">
            <span
              className={
                freshness.tone === 'stale'
                  ? 'text-[10px] font-medium text-[var(--color-warn)]'
                  : 'text-[10px] text-[var(--color-ink-3)]'
              }
            >
              {freshness.label}
            </span>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || refreshDisabled}
              className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)] disabled:opacity-60"
            >
              {generating ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {journey.nextBestAction && (
          <div className="mt-2 rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
            <p className="mb-1 text-xs text-[var(--color-ink-3)]">
              Record-based suggestion — review its fit, not a confirmed outcome.
            </p>
            <p className="font-medium text-[var(--color-ink)]">{journey.nextBestAction.title}</p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-2)]">
              {journey.nextBestAction.detail}
            </p>
            {journey.nextBestAction.ctaHref && (
              <Link
                href={journey.nextBestAction.ctaHref}
                className="mt-2 inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                {journey.nextBestAction.ctaLabel ?? 'Open'} →
              </Link>
            )}
          </div>
        )}
        {cachedBrief ? (
          <div className="mt-2 space-y-2 rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
            <p className="font-serif text-[var(--color-ink)]">{cachedBrief.contextLine}</p>
            <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">
              {cachedBrief.todaysFocus}
            </p>
            {cachedBrief.openingLine && (
              <p className="text-xs italic text-[var(--color-ink-2)]">
                Open with: &ldquo;{cachedBrief.openingLine}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            Refresh to generate a grounded pre-session brief.
          </p>
        )}
        <TodayIntent clientId={data.clientId} />
      </section>
    </div>
  );
}

/**
 * SL2 — "Last time you both agreed". Each agreement carries a three-state
 * follow-up (done / partly / not yet) persisted via
 * PATCH /sessions/[id]/agreements/[agreementId]. A mark is shown only after acknowledgment.
 */
function AgreementsThread({
  clientId,
  agreements,
  total,
  initialCursor,
  onPendingChange,
}: {
  clientId: string;
  agreements: SessionAgreementDto[];
  total: number;
  initialCursor: string | null;
  onPendingChange: (pending: boolean, busy: boolean) => void;
}) {
  const [rows, setRows] = useState(agreements);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [remainingTotal, setRemainingTotal] = useState(total);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<{
    agreement: SessionAgreementDto;
    followUp: AgreementFollowUp;
    originalText: string;
    reloaded?: boolean;
  } | null>(null);
  useUnsavedWorkGuard(
    !!pending,
    'This follow-up choice has not been saved. Leave without saving it?',
    busy,
  );
  useEffect(() => {
    onPendingChange(!!pending, busy);
  }, [pending, busy, onPendingChange]);
  useEffect(() => () => onPendingChange(false, false), [onPendingChange]);

  async function mark(a: SessionAgreementDto, followUp: AgreementFollowUp): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPending({ agreement: a, followUp, originalText: a.text });
    setError(null);
    setReceipt(null);
    setConflict(false);
    try {
      await saveAgreementFollowUp(a, followUp);
      setRows((current) => current.map((row) => (row.id === a.id ? { ...row, followUp } : row)));
      setPending(null);
      setReceipt(`Follow-up saved: ${followUpLabel(followUp)}.`);
    } catch (cause) {
      setConflict(cause instanceof AgreementFollowUpConflictError);
      setError(
        cause instanceof AgreementFollowUpConflictError
          ? cause.message
          : 'The follow-up could not be confirmed. Your unsaved choice is still here; the saved status has not changed.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reloadPending() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/sessions/${pending.agreement.sessionId}/agreements`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { agreements?: unknown[] };
      const latest = body.agreements
        ?.map((row) => SessionAgreementDtoSchema.safeParse(row))
        .find(
          (result) =>
            result.success &&
            result.data.id === pending.agreement.id &&
            result.data.sessionId === pending.agreement.sessionId,
        );
      if (!latest?.success) throw new Error();
      setRows((current) => current.map((row) => (row.id === latest.data.id ? latest.data : row)));
      setPending({ ...pending, agreement: latest.data, reloaded: true });
      setConflict(false);
      setError(
        'Latest wording loaded. Review it above before saving the follow-up choice you kept. Nothing has been changed by reloading.',
      );
    } catch {
      setError(
        'Could not reload this agreement. It may have been removed or changed. Your unsaved choice is still here; retry reload or discard the choice.',
      );
      setConflict(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/clients/${clientId}/agreements?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(15_000) },
      );
      const parsed = ActiveAgreementPageSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      const page = parsed.data;
      setRows((existing) => [
        ...existing,
        ...page.agreements.filter((a) => !existing.some((row) => row.id === a.id)),
      ]);
      setNextCursor(page.nextCursor);
      setRemainingTotal(page.total);
    } catch {
      setError(
        'Could not load the remaining commitments. The ones shown are not the full list; retry loading more.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Active commitments across sessions
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-3)]">
        {remainingTotal} unfinished commitments at last check. Oldest first; completing or retiring
        one keeps its history.
      </p>
      <ul className="mt-1.5 space-y-2">
        {rows.map((a) => (
          <li
            key={a.id}
            className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3"
          >
            <p className="text-xs text-[var(--color-ink)]">
              {a.speaker === 'CLIENT' ? <>&ldquo;{a.text}&rdquo;</> : a.text}
            </p>
            <Link
              href={`/app/sessions/${a.sessionId}#session-agreements`}
              className="mt-1 inline-block text-xs text-[var(--color-accent)] underline"
            >
              From {new Date(a.sourceSessionAt ?? a.createdAt).toLocaleDateString()} · open source
              session
            </Link>
            {a.retiredAt && <p className="mt-1 text-xs">Retired · {a.retirementReason}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ['DONE', 'Done'],
                  ['PARTLY', 'Partly'],
                  ['NOT_YET', 'Not yet'],
                ] as const
              ).map(([key, label]) => {
                const active = a.followUp === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || !!pending || !!a.retiredAt}
                    onClick={() => void mark(a, key)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                        : 'border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
                    }`}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <AgreementHomework agreement={a} disabled={busy || !!pending} />
            <RetireAgreement
              agreement={a}
              disabled={busy || !!pending}
              onSaved={(saved) =>
                setRows((current) =>
                  current.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)),
                )
              }
            />
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button
          type="button"
          className="mt-3 py-2 text-sm text-[var(--color-accent)] underline"
          disabled={loadingMore || busy || !!pending}
          onClick={() => void loadMore()}
        >
          {loadingMore ? 'Loading commitments…' : 'Load more active commitments'}
        </button>
      )}
      {busy && (
        <p role="status" className="mt-2 text-sm">
          Saving or checking your follow-up…
        </p>
      )}
      {receipt && (
        <p role="status" className="mt-2 text-sm text-[var(--color-ink-2)]">
          {receipt}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {pending && !busy && (
        <div className="mt-3 rounded-xl border border-[var(--color-warn-border)] p-3 text-sm">
          <p>Unsaved choice: {followUpLabel(pending.followUp)}.</p>
          <p className="mt-1 text-xs text-[var(--color-ink-2)]">
            Originally selected for: {pending.originalText}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {conflict ? (
              <button
                type="button"
                className="py-2 text-[var(--color-accent)] underline"
                onClick={() => void reloadPending()}
              >
                Reload latest wording
              </button>
            ) : (
              <button
                type="button"
                className="py-2 text-[var(--color-accent)] underline"
                onClick={() => void mark(pending.agreement, pending.followUp)}
              >
                {pending.reloaded
                  ? `Save ${followUpLabel(pending.followUp)} for this wording`
                  : 'Retry the same follow-up'}
              </button>
            )}
            <button
              type="button"
              className="py-2 text-[var(--color-ink-2)] underline"
              onClick={() => {
                setPending(null);
                setError(null);
                setConflict(false);
              }}
            >
              Discard unsaved choice
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function followUpLabel(followUp: AgreementFollowUp) {
  return followUp === 'DONE' ? 'Done' : followUp === 'PARTLY' ? 'Partly' : 'Not yet';
}

/**
 * SL2 — "Today I want to…": the therapist's private one-line intention for
 * the session. Deliberately local (localStorage, per client) — a scratch
 * thought, not a record.
 */
function TodayIntent({ clientId }: { clientId: string }) {
  const [storageKey, setStorageKey] = useState(() => prepareIntentKey(clientId));
  const [value, setValue] = useState('');
  const [legacyValue, setLegacyValue] = useState('');
  const [savedKey, setSavedKey] = useState(storageKey);
  const [persisted, setPersisted] = useState(true);

  useEffect(() => {
    const refreshDay = () => setStorageKey(prepareIntentKey(clientId));
    refreshDay();
    const timer = window.setInterval(refreshDay, 60_000);
    window.addEventListener('focus', refreshDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshDay);
    };
  }, [clientId]);

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(storageKey) ?? '');
      setLegacyValue(window.localStorage.getItem(`prepare-intent-${clientId}`) ?? '');
      setSavedKey(storageKey);
      setPersisted(true);
    } catch {
      setValue('');
      setLegacyValue('');
      setSavedKey(storageKey);
      setPersisted(false);
    }
  }, [storageKey, clientId]);

  function save(nextValue: string) {
    setValue(nextValue);
    try {
      window.localStorage.setItem(storageKey, nextValue);
      setPersisted(true);
    } catch {
      setPersisted(false);
    }
  }

  return (
    <section>
      <label
        htmlFor={`intent-${clientId}`}
        className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]"
      >
        Today I want to…
      </label>
      <input
        id={`intent-${clientId}`}
        type="text"
        value={savedKey === storageKey ? value : ''}
        maxLength={200}
        onChange={(e) => {
          save(e.target.value);
        }}
        placeholder="e.g. test the Saturday prediction; stay out of advice mode"
        className="mt-1.5 w-full rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-xs outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
        For today (IST) only. Stays on this device — a scratch thought, not part of the record.
      </p>
      {!persisted && (
        <p role="status" className="mt-1 text-xs text-[var(--color-warn)]">
          Device storage is unavailable. This scratch intention will not be retained when you leave.
        </p>
      )}
      {legacyValue && (
        <details className="mt-2 text-xs text-[var(--color-ink-2)]">
          <summary className="cursor-pointer py-2">
            Older undated intention — not carried forward
          </summary>
          <p className="whitespace-pre-wrap">{legacyValue}</p>
          <button
            type="button"
            className="py-2 text-[var(--color-accent)] underline"
            onClick={() => save(legacyValue)}
          >
            Use this intention today
          </button>
        </details>
      )}
    </section>
  );
}

function PrepareSafety({ openCrises }: { openCrises: PrepareSummaryV1['openCrises'] }) {
  return (
    <section aria-label="Preparation safety context">
      {openCrises.length ? (
        <div className="rounded-xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          <strong>Safety context — review before proceeding:</strong>
          <ul className="mt-1 list-disc pl-5">
            {openCrises.map((crisis) => (
              <li key={crisis.kind}>
                {crisis.source === 'CLINICIAN_NOTE_DRAFT'
                  ? 'Unfinished clinician-written draft — review'
                  : crisis.source === 'CLINICIAN_NOTE'
                    ? 'Clinician-written note'
                    : crisis.kind.replace(/_/g, ' ')}{' '}
                · {crisis.severity} · recorded{' '}
                {new Date(crisis.lastSeenAt).toLocaleDateString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
                {crisis.source && crisis.sourceSessionId && (
                  <>
                    {' '}
                    ·{' '}
                    <Link href={`/app/sessions/${crisis.sourceSessionId}`} className="underline">
                      Review source note
                    </Link>
                    . This is earlier documentation, not a current safety assessment.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-ink-3)]">
          No open high-risk flags in this record. This is not a safety assessment.
        </p>
      )}
    </section>
  );
}

function instrumentLabel(instrumentKey: string): string {
  return instrumentKey === 'PHQ9' ? 'PHQ-9' : instrumentKey === 'GAD7' ? 'GAD-7' : instrumentKey;
}

function verdictChip(verdict: string): string {
  if (verdict === 'reliable_improvement') return 'improving';
  if (verdict === 'deterioration') return 'worsening';
  return 'stable';
}

function homeworkTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'SKIPPED' || status === 'EXPIRED') return 'muted';
  if (status === 'IN_PROGRESS') return 'warn';
  return 'default';
}
