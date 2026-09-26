'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import {
  SCRIBE_TELECONSULT_HEARTBEAT_MS,
  type ScribeTeleconsultPatientConsent,
  type ScribeTeleconsultPublicStatus,
} from '@/lib/scribe-teleconsult-contracts';
import { VideoSessionRoom } from './VideoSessionRoom';

type PatientConsent = ScribeTeleconsultPatientConsent;
type OptOutIntent = { choice: 'declined' | 'withdrawn'; generation: number; revision: number };
export type ScribePatientCallStatus = ScribeTeleconsultPublicStatus;

/** Only accept the public, identity-free status contract. Unknown state is not permission. */
export function parseScribePatientCallStatus(value: unknown): ScribePatientCallStatus | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.id !== 'string' ||
    typeof data.linkVersion !== 'string' ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.revision) < 0 ||
    !['open', 'revoked', 'ended', 'expired'].includes(String(data.status)) ||
    typeof data.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    !['pending', 'granted', 'declined', 'withdrawn'].includes(String(data.patientConsent)) ||
    !(data.patientConsentAt === null || typeof data.patientConsentAt === 'string') ||
    !['idle', 'preparing', 'recording', 'draining', 'paused', 'finished'].includes(
      String(data.documentationState),
    ) ||
    !(
      data.documentationHeartbeatAt === null || typeof data.documentationHeartbeatAt === 'string'
    ) ||
    typeof data.canJoin !== 'boolean' ||
    typeof data.canDocument !== 'boolean'
  )
    return null;
  return {
    id: data.id,
    linkVersion: data.linkVersion,
    revision: Number(data.revision),
    status: data.status as ScribePatientCallStatus['status'],
    expiresAt: data.expiresAt,
    patientConsent: data.patientConsent as PatientConsent,
    patientConsentAt: data.patientConsentAt as string | null,
    documentationState: data.documentationState as ScribePatientCallStatus['documentationState'],
    documentationHeartbeatAt: data.documentationHeartbeatAt as string | null,
    canJoin: data.canJoin,
    canDocument: data.canDocument,
  };
}

export function scribeDocumentationLabel(
  status: ScribePatientCallStatus | null,
  verified: boolean,
) {
  if (!verified || !status) return 'AI documentation status unavailable';
  if (['preparing', 'recording', 'draining'].includes(status.documentationState)) {
    const heartbeat = status.documentationHeartbeatAt
      ? Date.parse(status.documentationHeartbeatAt)
      : NaN;
    if (
      !status.canDocument ||
      !Number.isFinite(heartbeat) ||
      Date.now() - heartbeat > SCRIBE_TELECONSULT_HEARTBEAT_MS
    )
      return 'AI documentation status unavailable';
    if (status.documentationState === 'preparing') return 'Preparing AI documentation';
    if (status.documentationState === 'draining') return 'Finishing captured audio';
    return 'AI documentation is active';
  }
  if (status.documentationState === 'finished') return 'AI documentation has finished';
  if (status.documentationState === 'paused') return 'AI documentation is paused';
  return 'AI documentation has not started';
}

const actionClass =
  'rounded-full border border-[var(--color-line)] px-5 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50';

export function ScribePatientCall({ teleconsultId }: { teleconsultId: string }) {
  const endpoint = `/api/v1/public/scribe/teleconsult/${encodeURIComponent(teleconsultId)}`;
  const [grant, setGrant] = useState<{ token: string; generation: number } | null>(null);
  const [status, setStatus] = useState<ScribePatientCallStatus | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [optOutIntent, setOptOutIntent] = useState<OptOutIntent | null>(null);
  const optOutRef = useRef<OptOutIntent | null>(null);
  const roomRef = useRef<Room | null>(null);
  const activeGrant = useRef<{ token: string; generation: number } | null>(null);
  const generation = useRef(0);
  const revision = useRef(-1);
  const requests = useRef(new Set<AbortController>());
  const mutation = useRef(false);
  const onRoom = useCallback((room: Room | null) => {
    roomRef.current = room;
  }, []);
  const disconnectCall = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (!room) return;
    // Stop the patient's physical inputs synchronously, before any network await.
    for (const publication of room.localParticipant.trackPublications.values())
      publication.track?.stop();
    void room.disconnect().catch(() => {
      /* The room component also cleans up on unmount. */
    });
  }, []);

  useEffect(() => {
    const readLink = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (token && token === activeGrant.current?.token) return;
      generation.current += 1;
      requests.current.forEach((controller) => controller.abort());
      requests.current.clear();
      activeGrant.current = token ? { token, generation: generation.current } : null;
      revision.current = -1;
      mutation.current = false;
      disconnectCall();
      optOutRef.current = null;
      setOptOutIntent(null);
      setChoiceError(null);
      setGrant(activeGrant.current);
      setStatus(null);
      setVerified(false);
      setSaving(false);
      setLoading(Boolean(token));
      setError(
        token
          ? null
          : 'Open the complete private link from your clinic, including the part after #.',
      );
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    window.addEventListener('popstate', readLink);
    return () => {
      window.removeEventListener('hashchange', readLink);
      window.removeEventListener('popstate', readLink);
      generation.current += 1;
      activeGrant.current = null;
      disconnectCall();
      requests.current.forEach((controller) => controller.abort());
      requests.current.clear();
    };
  }, [teleconsultId, disconnectCall]);

  const isCurrent = useCallback(
    (link: { token: string; generation: number }) =>
      activeGrant.current?.generation === link.generation &&
      activeGrant.current.token === link.token &&
      new URLSearchParams(window.location.hash.slice(1)).get('token') === link.token,
    [],
  );

  const acceptStatus = useCallback(
    (data: unknown, link: { token: string; generation: number }) => {
      const next = parseScribePatientCallStatus(data);
      if (!next || next.id !== teleconsultId)
        throw new Error('The consultation status could not be verified.');
      if (!isCurrent(link))
        throw new Error('The consultation link changed. Open your current link again.');
      if (next.revision >= revision.current) {
        revision.current = next.revision;
        setStatus(next);
        const intent = optOutRef.current;
        if (
          intent?.generation === link.generation &&
          next.revision >= intent.revision &&
          (next.patientConsent === 'declined' || next.patientConsent === 'withdrawn')
        ) {
          optOutRef.current = null;
          setOptOutIntent(null);
          setChoiceError(null);
        }
      }
      setVerified(true);
      return next;
    },
    [isCurrent, teleconsultId],
  );

  useEffect(() => {
    if (!grant) return;
    let inFlight = false;
    let stopped = false;
    const poll = async () => {
      if (stopped || inFlight || !isCurrent(grant)) return;
      inFlight = true;
      const controller = new AbortController();
      requests.current.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 6_000);
      try {
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${grant.token}` },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            'This private consultation link could not be verified. Ask your clinic for a new link if this continues.',
          );
        const body: unknown = await response.json();
        if (stopped || !isCurrent(grant)) return;
        acceptStatus(body, grant);
        setError(null);
      } catch {
        if (stopped || !isCurrent(grant)) return;
        setVerified(false);
        setError(
          'We cannot verify the consultation or AI documentation status. The call is disconnected while we retry.',
        );
      } finally {
        window.clearTimeout(timeout);
        requests.current.delete(controller);
        inFlight = false;
        if (!stopped && isCurrent(grant)) setLoading(false);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [acceptStatus, endpoint, grant, isCurrent]);

  const consent = async (choice: Exclude<PatientConsent, 'pending'>) => {
    if (!grant || !isCurrent(grant) || mutation.current || (choice === 'granted' && !verified))
      return;
    if (choice !== 'granted') {
      const intent = { choice, generation: grant.generation, revision: revision.current };
      optOutRef.current = intent;
      setOptOutIntent(intent);
      disconnectCall();
    }
    mutation.current = true;
    setSaving(true);
    setError(null);
    setChoiceError(null);
    const controller = new AbortController();
    requests.current.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: grant.token,
          action: 'consent',
          consent: choice,
          expectedRevision: revision.current,
        }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error('Your choice was not confirmed. Check your connection and try again.');
      const body: unknown = await response.json();
      if (!isCurrent(grant)) return;
      const next = acceptStatus(body, grant);
      if (
        choice === 'granted' &&
        next.patientConsent === 'granted' &&
        next.revision >= revision.current
      ) {
        // Only this explicit, confirmed opt-in may cancel an outstanding opt-out.
        optOutRef.current = null;
        setOptOutIntent(null);
        setChoiceError(null);
      } else if (choice === 'granted' || optOutRef.current) {
        throw new Error('The requested choice was not confirmed.');
      }
    } catch {
      if (!isCurrent(grant)) return;
      setVerified(false);
      setChoiceError(
        choice === 'withdrawn'
          ? 'Your withdrawal could not be confirmed. The call is disconnected; contact your doctor before continuing.'
          : 'Your choice was not confirmed. Check your connection and try again.',
      );
    } finally {
      window.clearTimeout(timeout);
      requests.current.delete(controller);
      if (isCurrent(grant)) {
        mutation.current = false;
        setSaving(false);
      }
    }
  };

  const requestToken = useCallback(
    async (signal: AbortSignal) => {
      if (!grant || !isCurrent(grant) || optOutRef.current)
        throw new Error('Open your current private consultation link again.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: grant.token, action: 'token' }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal,
      });
      const body = (await response.json().catch(() => null)) as
        | (ScribePatientCallStatus & { token?: string; url?: string })
        | null;
      if (!response.ok || !body?.token || !body.url || !isCurrent(grant) || optOutRef.current)
        throw new Error('The room could not be opened. Check your private link and try again.');
      const next = acceptStatus(body, grant);
      if (!next.canJoin || next.status !== 'open')
        throw new Error('This consultation room is closed.');
      return { token: body.token, url: body.url };
    },
    [acceptStatus, endpoint, grant, isCurrent],
  );

  const expired = Boolean(status && Date.parse(status.expiresAt) <= Date.now());
  const canJoin = Boolean(
    verified && status?.canJoin && status.status === 'open' && !expired && !optOutIntent,
  );
  const closed = Boolean(status && (status.status !== 'open' || !status.canJoin || expired));
  const hasConsented = status?.patientConsent === 'granted';
  const documentationLabel = scribeDocumentationLabel(status, verified);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 text-[var(--color-ink)] sm:px-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-5">
        <p className="font-serif text-2xl">Cureocity Scribe</p>
        <p className="text-sm text-[var(--color-ink-2)]">Your private video consultation</p>
      </header>
      <h1 className="font-serif text-3xl sm:text-4xl">Meet your doctor</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-ink-2)]">
        You can join the consultation without allowing AI documentation. Joining the call is not
        consent to AI documentation.
      </p>
      {(choiceError || error) && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm leading-6 text-[var(--color-ink)]"
        >
          {choiceError || error}
        </p>
      )}
      {loading && (
        <p role="status" className="py-10 text-sm text-[var(--color-ink-2)]">
          Checking your private consultation link…
        </p>
      )}
      {closed && (
        <section className="my-8 border-y border-[var(--color-line)] py-8">
          <h2 className="font-serif text-2xl">This consultation link is closed</h2>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Ask your clinic for a new link if you still need to meet your doctor. You can close this
            page.
          </p>
        </section>
      )}
      {!loading && !closed && grant && (
        <section
          aria-labelledby="documentation-choice"
          className="my-6 border-y border-[var(--color-line)] py-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="documentation-choice" className="text-base font-semibold">
              Your choice about AI documentation
            </h2>
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {documentationLabel}
            </p>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-ink-2)]">
            If you allow it, consultation audio is streamed to AI services to draft medical
            documentation. The transcript and reviewed notes are retained in your clinical record.
            This feature does not record video. Service providers may process audio and other
            consultation data outside India. Your doctor reviews the draft before signing.
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-ink-2)]">
            You can withdraw permission at any time. This stops further AI capture; it does not
            automatically delete documentation already created.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {optOutIntent ? (
              <>
                <p className="w-full text-sm">
                  Your no-AI choice is waiting for confirmation. The call stays disconnected until
                  your choice is confirmed.
                </p>
                <button
                  type="button"
                  className={actionClass}
                  disabled={saving}
                  onClick={() => void consent(optOutIntent.choice)}
                >
                  {saving ? 'Confirming your choice…' : 'Retry no-AI choice'}
                </button>
                <button
                  type="button"
                  className={actionClass}
                  disabled={saving || !verified}
                  onClick={() => void consent('granted')}
                >
                  Allow AI documentation instead
                </button>
              </>
            ) : hasConsented ? (
              <>
                <p className="mr-2 text-sm">You allowed AI documentation.</p>
                <button
                  type="button"
                  className={actionClass}
                  disabled={saving}
                  onClick={() => void consent('withdrawn')}
                >
                  {saving ? 'Saving your choice…' : 'Withdraw AI permission'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`${actionClass} bg-[var(--color-accent)] text-white`}
                  disabled={saving || !canJoin}
                  onClick={() => void consent('granted')}
                >
                  {saving ? 'Saving your choice…' : 'Allow AI documentation'}
                </button>
                <button
                  type="button"
                  className={actionClass}
                  disabled={saving || !canJoin}
                  onClick={() => void consent('declined')}
                >
                  Continue without AI
                </button>
                {(status?.patientConsent === 'declined' ||
                  status?.patientConsent === 'withdrawn') && (
                  <p className="text-sm text-[var(--color-ink-2)]">
                    Your choice: no AI documentation.
                  </p>
                )}
              </>
            )}
          </div>
          {!verified && (
            <p className="mt-3 text-sm text-[var(--color-ink-2)]">
              Waiting for a verified connection. Do not assume documentation is off; contact your
              doctor if you need to stop it.
            </p>
          )}
        </section>
      )}
      {canJoin && (
        <div className="h-[min(70vh,680px)] min-h-[420px]">
          <VideoSessionRoom
            key={`${teleconsultId}-${grant?.generation}`}
            tokenEndpoint={endpoint}
            requestToken={requestToken}
            onRoom={onRoom}
            counterpartLabel="your doctor"
            leaveHref={`/p/scribe/teleconsult/${encodeURIComponent(teleconsultId)}`}
            onLeave={() => {
              /* Stay on this private page; never redirect into Mind. */
            }}
            title="Your video consultation"
            joinLabel="Join consultation"
            leaveLabel="Leave consultation"
            chrome="embedded"
          />
        </div>
      )}
      <p className="mt-5 max-w-3xl text-xs leading-5 text-[var(--color-ink-2)]">
        Keep this private link to yourself. If you cannot join, contact your clinic. This
        consultation page is not an emergency service.
      </p>
    </main>
  );
}
