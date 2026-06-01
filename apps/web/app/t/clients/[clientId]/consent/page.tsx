'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { tUi, type UiLocale } from '@/lib/i18n';
import { authenticateWithChallenge } from '@/lib/webauthn';

type Scope = 'AUDIO_RECORDING' | 'AI_NOTE_GENERATION' | 'CROSS_BORDER_PROCESSING';

const SCRIPT_VERSION = 'v1.0';

/**
 * ConsentScreen — bilingual (EN/HI) read-aloud script with scope
 * toggles + WebAuthn biometric capture for non-repudiation.
 *
 * Per-CLIENT consents are persisted at client creation time (see the
 * "Add client" form on /t/clients). Per-SESSION consent acks happen
 * inside the capture screen (POST /sessions/:id/consent). This page
 * is the read-aloud script the therapist walks through with the
 * patient, with optional biometric proof for high-assurance flows.
 *
 * Sprint 9 wires the captured assertion to a dedicated
 * /clients/:id/consents/reaffirm endpoint; until then it's recorded
 * client-side only and the "done" banner means "script completed."
 */
export default function ConsentPage() {
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const [locale, setLocale] = useState<UiLocale>('en');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({
    AUDIO_RECORDING: true,
    AI_NOTE_GENERATION: true,
    CROSS_BORDER_PROCESSING: false,
  });
  const [status, setStatus] = useState<'idle' | 'capturing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function toggle(scope: Scope): void {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }

  async function capture(): Promise<void> {
    setStatus('capturing');
    setError(null);
    try {
      const enabledScopes = (Object.keys(scopes) as Scope[]).filter((s) => scopes[s]);
      if (enabledScopes.length === 0) {
        throw new Error('At least one consent scope must be enabled.');
      }
      const payload = JSON.stringify({
        clientId: params.clientId,
        scopes: enabledScopes,
        scriptVersion: SCRIPT_VERSION,
        locale,
        capturedAt: new Date().toISOString(),
      });
      // V1: attempt WebAuthn but degrade gracefully if not available —
      // Sprint 7 PR 4 makes it strictly required.
      try {
        await authenticateWithChallenge(payload);
      } catch (e) {
        if (!/WebAuthn not supported/.test((e as Error).message)) throw e;
      }
      // TODO(Sprint 7 PR 4): POST to patient-model-service +
      // scribe-service with the assertion payload.
      setStatus('done');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--color-navy-700)]">
          {tUi(locale, 'consent.title')}
        </h1>
        <div className="flex gap-2 rounded-md border border-[var(--color-slate-200)] bg-white p-1">
          {(['en', 'hi'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`rounded px-2 py-1 text-xs font-medium ${locale === l ? 'bg-[var(--color-navy-700)] text-white' : 'text-[var(--color-slate-500)]'}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <p className="mb-8 text-sm text-[var(--color-slate-500)]">{tUi(locale, 'consent.body')}</p>

      <ul className="space-y-3">
        {(['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'] as const).map(
          (scope) => (
            <li
              key={scope}
              className="flex items-start gap-3 rounded-lg border border-[var(--color-slate-200)] bg-white p-4"
            >
              <input
                id={scope}
                type="checkbox"
                checked={scopes[scope]}
                onChange={() => toggle(scope)}
                className="mt-1 h-4 w-4"
              />
              <label htmlFor={scope} className="flex-1 text-sm">
                <span className="block font-medium">
                  {tUi(
                    locale,
                    scope === 'AUDIO_RECORDING'
                      ? 'consent.audio'
                      : scope === 'AI_NOTE_GENERATION'
                        ? 'consent.aiNotes'
                        : 'consent.crossBorder',
                  )}
                </span>
                <span className="mt-1 block text-[var(--color-slate-500)]">
                  {tUi(
                    locale,
                    scope === 'AUDIO_RECORDING'
                      ? 'consent.audioBody'
                      : scope === 'AI_NOTE_GENERATION'
                        ? 'consent.aiNotesBody'
                        : 'consent.crossBorderBody',
                  )}
                </span>
              </label>
            </li>
          ),
        )}
      </ul>

      <p className="mt-6 text-xs text-[var(--color-slate-500)]">
        {tUi(locale, 'consent.scriptVersion')}: {SCRIPT_VERSION}
      </p>

      {status === 'done' ? (
        <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ {tUi(locale, 'consent.recorded')}
          <button
            type="button"
            onClick={() => router.push(`/t/clients/${params.clientId}`)}
            className="ml-3 underline"
          >
            Continue
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={capture}
          disabled={status === 'capturing'}
          className="mt-8 w-full rounded-md bg-[var(--color-navy-700)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'capturing'
            ? tUi(locale, 'session.preparing')
            : tUi(locale, 'consent.captureBiometric')}
        </button>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </main>
  );
}
