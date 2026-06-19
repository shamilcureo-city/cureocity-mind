'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MedicalEncounterNoteV1Schema, type MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LiveRecorder } from './LiveRecorder';
import { MedicalNoteView } from './MedicalNoteView';
import { EncounterOrdersPanel } from './EncounterOrdersPanel';

/**
 * Sprint DV3 — the doctor encounter workspace body. Drives the record →
 * note loop on the existing batch pipeline:
 *   consent → start → record → end → generate-note → poll → render.
 * Reuses LiveRecorder (audio capture) + the medical note from Pass 2's
 * MEDICAL arm. Sign + after-visit summary land in the next chunk.
 * See docs/DOCTOR_VERTICAL.md.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'idle' } // no draft yet, ready to record
  | { kind: 'starting' } // consent + start in flight
  | { kind: 'recording' }
  | { kind: 'generating' } // draft PENDING / IN_PROGRESS, polling
  | { kind: 'done'; note: MedicalEncounterNoteV1 }
  | { kind: 'failed'; message: string };

// DPDP scopes the scribe pipeline needs; the patient granted them at
// creation, this re-confirms them for the encounter (the /start route
// refuses without a session consent snapshot).
const CONSENT_SCOPES = ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'];

export function DoctorEncounterPanel({
  sessionId,
  clientId,
  clientName,
  sessionStatus,
}: {
  sessionId: string;
  clientId: string;
  clientName: string;
  sessionStatus: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(
    sessionStatus === 'IN_PROGRESS' ? { kind: 'recording' } : { kind: 'loading' },
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reviewHref = `/app/patients/${clientId}/encounters/${sessionId}`;
  const [signed, setSigned] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const fetchDraft = useCallback(async () => {
    const res = await fetch(`/api/v1/sessions/${sessionId}/note-draft`);
    if (res.status === 404) {
      setState({ kind: 'idle' });
      return;
    }
    if (!res.ok) {
      setState({ kind: 'failed', message: `Could not load the note (${res.status}).` });
      return;
    }
    const draft = (await res.json()) as {
      status: string;
      content: unknown;
      errorMessage: string | null;
    };
    if (draft.status === 'COMPLETED') {
      const parsed = MedicalEncounterNoteV1Schema.safeParse(draft.content);
      setState(
        parsed.success
          ? { kind: 'done', note: parsed.data }
          : { kind: 'failed', message: 'The note could not be read.' },
      );
    } else if (draft.status === 'FAILED') {
      setState({ kind: 'failed', message: draft.errorMessage ?? 'Note generation failed.' });
    } else {
      setState({ kind: 'generating' });
    }
  }, [sessionId]);

  // Initial load — unless we mounted straight into an in-progress recording.
  useEffect(() => {
    if (sessionStatus !== 'IN_PROGRESS') void fetchDraft();
  }, [fetchDraft, sessionStatus]);

  // Poll while the note is being generated.
  useEffect(() => {
    if (state.kind !== 'generating') return;
    pollRef.current = setInterval(() => void fetchDraft(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.kind, fetchDraft]);

  async function beginRecording(): Promise<void> {
    setState({ kind: 'starting' });
    try {
      const consent = await fetch(`/api/v1/sessions/${sessionId}/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes: CONSENT_SCOPES, scriptVersion: 'v1.0' }),
      });
      if (!consent.ok) throw new Error(await errorOf(consent, 'Could not record consent'));
      const started = await fetch(`/api/v1/sessions/${sessionId}/start`, { method: 'POST' });
      if (!started.ok) throw new Error(await errorOf(started, 'Could not start the encounter'));
      setState({ kind: 'recording' });
    } catch (e) {
      setState({ kind: 'failed', message: (e as Error).message });
    }
  }

  async function regenerate(): Promise<void> {
    setState({ kind: 'generating' });
    try {
      await fetch(`/api/v1/sessions/${sessionId}/generate-note`, { method: 'POST' });
    } catch {
      /* polling surfaces the outcome */
    }
    void fetchDraft();
  }

  // Sign-off. The seeded doctor has no WebAuthn credential, so the
  // assertion-less path applies; a doctor who registers one would be
  // required to assert (same rule as the therapist sign route). The note
  // is signed as-drafted (no field edits in this MVP).
  async function sign(note: MedicalEncounterNoteV1): Promise<void> {
    setSigning(true);
    setSignError(null);
    try {
      const payload = JSON.stringify(note);
      const payloadHashHex = await sha256Hex(payload);
      const res = await fetch(`/api/v1/sessions/${sessionId}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload,
          payloadHashHex,
          note,
          edits: [],
          signedAt: new Date().toISOString(),
        }),
      });
      if (res.status === 409) {
        setSigned(true); // already signed in a previous visit
        return;
      }
      if (!res.ok) throw new Error(await errorOf(res, 'Could not sign the note'));
      setSigned(true);
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  // After-visit summary — built from the signed note and shared via the
  // existing PatientShare pipeline (PORTAL_LINK is always available; the
  // therapist can copy the link or send WhatsApp/email where configured).
  async function shareAvs(): Promise<void> {
    setSharing(true);
    setShareError(null);
    try {
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels: ['PORTAL_LINK'],
          artefact: { artefactType: 'AFTER_VISIT_SUMMARY', sessionId },
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not create the summary'));
      const data = (await res.json()) as { results: { portalUrl: string }[] };
      setShareUrl(data.results[0]?.portalUrl ?? null);
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  if (state.kind === 'loading' || state.kind === 'starting') {
    return (
      <Card className="p-8 text-center text-sm text-[var(--color-ink-3)]">
        {state.kind === 'starting' ? 'Preparing the encounter…' : 'Loading…'}
      </Card>
    );
  }

  if (state.kind === 'idle') {
    return (
      <Card className="space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-ink-2)]">
          Ready to record this encounter. The medical note drafts itself from the consultation; you
          confirm and sign it.
        </p>
        <div className="flex justify-center">
          <Button onClick={beginRecording}>Begin recording</Button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Confirms the patient&rsquo;s recording consent for this encounter, then starts.
        </p>
      </Card>
    );
  }

  if (state.kind === 'recording') {
    return (
      <LiveRecorder
        sessionId={sessionId}
        clientName={clientName}
        modality={null}
        source="mic"
        reviewHref={reviewHref}
        onFinished={() => setState({ kind: 'generating' })}
      />
    );
  }

  if (state.kind === 'generating') {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium text-[var(--color-ink)]">Writing the note…</p>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Transcribing the encounter and drafting the medical note. This usually takes a few
          seconds.
        </p>
      </Card>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Card className="space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-warn)]">{state.message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={regenerate} variant="secondary">
            Re-run
          </Button>
          <Button onClick={() => router.refresh()} variant="ghost">
            Reload
          </Button>
        </div>
      </Card>
    );
  }

  // done
  return (
    <div className="space-y-4">
      <Card className="p-7">
        <MedicalNoteView note={state.note} />
      </Card>
      <EncounterOrdersPanel sessionId={sessionId} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {signed ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent)]">
              ✓ Signed
            </span>
            {shareUrl ? (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener"
                className="text-sm text-[var(--color-accent)] underline"
              >
                Open the patient summary ↗
              </a>
            ) : (
              <Button onClick={shareAvs} disabled={sharing} variant="secondary">
                {sharing ? 'Creating…' : 'Share after-visit summary'}
              </Button>
            )}
          </>
        ) : (
          <Button onClick={() => sign(state.note)} disabled={signing}>
            {signing ? 'Signing…' : 'Confirm &amp; sign'}
          </Button>
        )}
      </div>
      {signError && <p className="text-right text-sm text-[var(--color-warn)]">{signError}</p>}
      {shareError && <p className="text-right text-sm text-[var(--color-warn)]">{shareError}</p>}
    </div>
  );
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${fallback} (${res.status}).`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
