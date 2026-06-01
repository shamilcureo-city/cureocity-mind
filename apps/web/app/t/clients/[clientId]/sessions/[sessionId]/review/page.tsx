'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { NoteDraft, TherapyNote, TherapyNoteV1 } from '@cureocity/contracts';
import { tUi, type UiLocale } from '@/lib/i18n';
import { authenticateWithChallenge, sha256Hex } from '@/lib/webauthn';

const SCRIBE_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

/**
 * ReviewScreen — inline note editing, risk acknowledgement, WebAuthn
 * sign-off.
 *
 * The note hash is bound into the WebAuthn challenge so the server
 * can verify "this exact note text was signed by this clinician".
 * Backend endpoint lands in Sprint 7 PR 4.
 *
 * NoteEdit history (gap G11) lives in the backend Schema (PR 4); this
 * page captures edits client-side and POSTs them as a batch on sign.
 */
export default function ReviewPage() {
  const params = useParams<{ sessionId: string }>();
  const locale: UiLocale = 'en';
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [edits, setEdits] = useState<Partial<TherapyNoteV1>>({});
  const [riskAcked, setRiskAcked] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signedNote, setSignedNote] = useState<TherapyNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(): Promise<void> {
      try {
        const [draftRes, signedRes] = await Promise.all([
          fetch(`${SCRIBE_BASE}/sessions/${params.sessionId}/note-draft`, { cache: 'no-store' }),
          fetch(`${SCRIBE_BASE}/sessions/${params.sessionId}/therapy-note`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        // 404 on draft is expected while the orchestrator is still
        // setting up — retry rather than surfacing an error.
        if (draftRes.status === 404) {
          timer = setTimeout(() => void load(), 2_000);
          return;
        }
        if (!draftRes.ok) throw new Error(`Draft fetch failed: ${draftRes.status}`);
        const draftJson = (await draftRes.json()) as NoteDraft;
        setDraft(draftJson);
        if (signedRes.ok) {
          const json = (await signedRes.json()) as TherapyNote | null;
          if (json !== null) {
            setSignedNote(json);
            setSigned(true);
          }
        }
        // Keep polling while the orchestrator is still working.
        if (draftJson.status === 'PENDING' || draftJson.status === 'IN_PROGRESS') {
          timer = setTimeout(() => void load(), 2_000);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.sessionId]);

  if (!draft) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-[var(--color-slate-500)]">{error ?? 'Loading draft…'}</p>
      </main>
    );
  }
  if (draft.status === 'PENDING' || draft.status === 'IN_PROGRESS') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-[var(--color-slate-500)]">
          Generating note from the recording… this usually takes 10–30 seconds.
        </p>
      </main>
    );
  }
  if (draft.status === 'FAILED' || !draft.content) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Note generation failed: {draft.errorMessage ?? 'unknown error'}
        </div>
      </main>
    );
  }

  const note = { ...draft.content, ...edits } as TherapyNoteV1;
  const dirty = Object.keys(edits).length > 0;
  const riskHigh = note.riskFlags.severity === 'high' || note.riskFlags.severity === 'critical';

  async function sign(): Promise<void> {
    if (!draft || !draft.content) return;
    const draftContent = draft.content;
    setBusy(true);
    setError(null);
    try {
      if (riskHigh && !riskAcked) {
        throw new Error('Risk acknowledgement required for high / critical severity');
      }
      // Build the explicit edit list — only fields that actually changed.
      const editList = (Object.keys(edits) as (keyof TherapyNoteV1)[])
        .filter((field): field is 'subjective' | 'objective' | 'assessment' | 'plan' =>
          ['subjective', 'objective', 'assessment', 'plan'].includes(field as string),
        )
        .map((field) => ({
          field,
          before: draftContent[field],
          after: note[field],
        }));
      const signedAt = new Date().toISOString();
      const payload = JSON.stringify({
        sessionId: params.sessionId,
        note,
        edits: editList,
        signedAt,
      });
      const payloadHashHex = await sha256Hex(payload);
      // V1: attempt WebAuthn but degrade gracefully if the browser lacks
      // the API. The server records the proof when present; full
      // signature-vs-public-key verification lands in Sprint 9 once the
      // registration endpoint exists.
      let assertion: Awaited<ReturnType<typeof authenticateWithChallenge>> | null = null;
      try {
        assertion = await authenticateWithChallenge(payload);
      } catch (e) {
        if (!/WebAuthn not supported/.test((e as Error).message)) throw e;
      }
      const body: Record<string, unknown> = {
        payload,
        payloadHashHex,
        note,
        edits: editList,
        signedAt,
      };
      if (assertion) {
        body.assertion = {
          credentialId: assertion.credentialId,
          clientDataJSON: assertion.clientDataJSON,
          authenticatorData: assertion.authenticatorData,
          signature: assertion.signature,
          challengeHashHex: assertion.challengeHashHex,
        };
      }
      const res = await fetch(`${SCRIBE_BASE}/sessions/${params.sessionId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sign failed: ${res.status} ${text}`);
      }
      const signedJson = (await res.json()) as TherapyNote;
      setSignedNote(signedJson);
      setSigned(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--color-navy-700)]">
          {tUi(locale, 'review.title')}
        </h1>
        {signed && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            ✓ {tUi(locale, 'review.signed')}
          </span>
        )}
      </header>

      {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
        <section key={field} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
            {field}
          </h2>
          <textarea
            value={note[field]}
            onChange={(e) => setEdits((prev) => ({ ...prev, [field]: e.target.value }))}
            rows={4}
            disabled={signed}
            className="w-full rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-2 text-sm focus:border-[var(--color-navy-500)] focus:outline-none disabled:opacity-60"
          />
        </section>
      ))}

      <section
        className={`mb-6 rounded-lg border p-4 ${
          riskHigh ? 'border-orange-300 bg-orange-50' : 'border-[var(--color-slate-200)] bg-white'
        }`}
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Risk flags
        </h2>
        <p className="text-sm">
          <strong>{note.riskFlags.severity.toUpperCase()}</strong>
          {note.riskFlags.indicators.length > 0 && (
            <span> — {note.riskFlags.indicators.join(', ')}</span>
          )}
        </p>
        {note.riskFlags.details && (
          <p className="mt-2 text-sm text-[var(--color-slate-500)]">{note.riskFlags.details}</p>
        )}
        {riskHigh && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={riskAcked}
              onChange={(e) => setRiskAcked(e.target.checked)}
              className="mt-1"
            />
            <span>{tUi(locale, 'review.riskAckLabel')}</span>
          </label>
        )}
      </section>

      {!signed && (
        <button
          type="button"
          onClick={sign}
          disabled={busy || (riskHigh && !riskAcked)}
          className="w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy
            ? 'Signing…'
            : `${tUi(locale, 'review.sign')}${dirty ? ` (${Object.keys(edits).length} edits)` : ''}`}
        </button>
      )}

      {signedNote && signedNote.edits.length > 0 && (
        <section className="mt-6 rounded-lg border border-[var(--color-slate-200)] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
            Revision history ({signedNote.edits.length})
          </h2>
          <p className="mb-3 text-xs text-[var(--color-slate-500)]">
            Signed {new Date(signedNote.signedAt).toLocaleString()} by{' '}
            <code className="text-[var(--color-slate-900)]">{signedNote.signedBy}</code>
          </p>
          <ul className="space-y-3">
            {signedNote.edits.map((e) => (
              <li key={e.id} className="rounded-md border border-[var(--color-slate-200)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
                  {e.field}
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-md bg-red-50 p-2 text-xs text-red-900">
                    <p className="mb-1 font-semibold">Before</p>
                    <p className="whitespace-pre-wrap">{e.before}</p>
                  </div>
                  <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-900">
                    <p className="mb-1 font-semibold">After</p>
                    <p className="whitespace-pre-wrap">{e.after}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </main>
  );
}
