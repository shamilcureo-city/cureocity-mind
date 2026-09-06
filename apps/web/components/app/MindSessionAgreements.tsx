'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionAgreementDto } from '@cureocity/contracts';
import { Button } from '../ui/Button';

/** Manual care decisions are available even if the AI report is unavailable.
 * Post-sign additions are separate audited care decisions, not edits to a signature. */
export function MindSessionAgreements({
  sessionId,
  signed,
}: {
  sessionId: string;
  signed: boolean;
}) {
  const router = useRouter();
  const [agreements, setAgreements] = useState<SessionAgreementDto[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    void fetch(`/api/v1/sessions/${sessionId}/agreements`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load agreements.');
        return response.json() as Promise<{ agreements: SessionAgreementDto[] }>;
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setAgreements(body.agreements);
          setLoaded(true);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load agreements. Retry before adding anything.');
      });
    return () => controller.abort();
  }, [sessionId, retry]);

  async function add() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/agreements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), speaker: 'THERAPIST' }),
      });
      const body = (await response.json()) as { agreement?: SessionAgreementDto; error?: string };
      if (!response.ok || !body.agreement)
        throw new Error(body.error ?? 'Could not save the agreement.');
      setAgreements((previous) => [...previous, body.agreement!]);
      setText('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the agreement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="session-agreements"
      className="mt-5 space-y-3 border-t border-[var(--color-line-soft)] pt-4"
      aria-labelledby="session-agreements-title"
    >
      <h4 id="session-agreements-title" className="text-sm font-semibold">
        What you agreed / homework
      </h4>
      <p className="text-xs text-[var(--color-ink-2)]">
        {signed
          ? 'Additions are saved as separate care decisions. They do not alter the signed note or send a message to the client.'
          : 'Capture the next practical step in your own words. No AI analysis is required.'}
      </p>
      <ul className="space-y-2 text-sm">
        {agreements.map((agreement) => (
          <li key={agreement.id} className="rounded-xl bg-[var(--color-surface-soft)] p-3">
            {agreement.text}
          </li>
        ))}
      </ul>
      {loaded ? (
        <>
          <label htmlFor="closeout-agreement" className="block text-sm">
            Agreed next step
          </label>
          <textarea
            id="closeout-agreement"
            rows={3}
            maxLength={500}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-xl border border-[var(--color-line)] p-3 text-sm"
          />
          <Button
            size="sm"
            disabled={busy || !text.trim() || agreements.length >= 8}
            onClick={() => void add()}
          >
            {busy ? 'Saving…' : signed ? 'Add care decision' : 'Save agreement'}
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>
          {error ? 'Retry loading agreements' : 'Loading agreements…'}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </section>
  );
}
