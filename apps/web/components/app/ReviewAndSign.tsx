'use client';

import { useState, type ReactNode } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { MedicalNoteView } from './MedicalNoteView';
import { PlanComposer } from './PlanComposer';
import { EncounterDifferentialPanel } from './EncounterDifferentialPanel';
import { EncounterOrdersPanel } from './EncounterOrdersPanel';
import { EncounterInteropPanel } from './EncounterInteropPanel';

/**
 * Sprint DS11.2 — the ONE review-and-sign surface.
 *
 * Both consult paths end here: the live page renders it as its done state
 * (no more FinalNote → "Open the encounter →" detour), and the batch
 * encounter workspace renders it once the note draft completes. Note →
 * plan composer → differential → orders → interop → sign/share, extracted
 * verbatim from DoctorEncounterPanel so the batch behavior is unchanged.
 *
 * `onSigned` lets the live page arm the TurnoverBar only AFTER the
 * signature lands — sign first, then chain to the next patient.
 */
export function ReviewAndSign({
  sessionId,
  clientId,
  note,
  header,
  onSigned,
}: {
  sessionId: string;
  /** Needed for patient shares; when absent the share buttons hide. */
  clientId?: string | undefined;
  note: MedicalEncounterNoteV1;
  /** Optional slot above the note (the live page's "consult ended" line). */
  header?: ReactNode;
  onSigned?: () => void;
}) {
  const [signed, setSigned] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  // Sprint DS5-fu — an assembled Rx pad enables the prescription PDF +
  // patient share; consults with no Rx hide them. Fed by PlanComposer.
  const [hasRx, setHasRx] = useState(false);
  const [rxShareUrl, setRxShareUrl] = useState<string | null>(null);
  const [rxSharing, setRxSharing] = useState(false);

  // Sign-off. A doctor with a registered WebAuthn credential is required
  // to assert (same rule as the therapist sign route). The note is signed
  // as-drafted (no field edits in this MVP).
  async function sign(): Promise<void> {
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
        onSigned?.();
        return;
      }
      if (!res.ok) throw new Error(await errorOf(res, 'Could not sign the note'));
      setSigned(true);
      onSigned?.();
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  // After-visit summary — built from the signed note and shared via the
  // existing PatientShare pipeline (PORTAL_LINK is always available).
  async function shareAvs(): Promise<void> {
    if (!clientId) return;
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

  // Sprint DS5-fu — share the SIGNED prescription (confirmed meds only).
  async function shareRx(): Promise<void> {
    if (!clientId) return;
    setRxSharing(true);
    setShareError(null);
    try {
      const res = await fetch('/api/v1/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          channels: ['PORTAL_LINK'],
          artefact: { artefactType: 'RX_PAD', sessionId },
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not create the prescription'));
      const data = (await res.json()) as { results: { portalUrl: string }[] };
      setRxShareUrl(data.results[0]?.portalUrl ?? null);
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setRxSharing(false);
    }
  }

  return (
    <div className="space-y-4">
      {header}
      <Card className="p-7">
        <MedicalNoteView note={note} />
      </Card>
      {/* Sprint DS10-B — two plans, one sign-off. */}
      <PlanComposer sessionId={sessionId} signed={signed} onPadChange={setHasRx} />
      <EncounterDifferentialPanel sessionId={sessionId} />
      <EncounterOrdersPanel sessionId={sessionId} />
      <EncounterInteropPanel sessionId={sessionId} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {signed ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent)]">
              ✓ Signed
            </span>
            {clientId &&
              (shareUrl ? (
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
              ))}
            {/* Sprint DS5-fu — the signed prescription: letterhead PDF +
                patient share. */}
            {hasRx && (
              <>
                <a
                  href={`/api/v1/sessions/${sessionId}/rx/pdf`}
                  target="_blank"
                  rel="noopener"
                  className="text-sm text-[var(--color-accent)] underline"
                >
                  Prescription PDF ↧
                </a>
                {clientId &&
                  (rxShareUrl ? (
                    <a
                      href={rxShareUrl}
                      target="_blank"
                      rel="noopener"
                      className="text-sm text-[var(--color-accent)] underline"
                    >
                      Open the patient prescription ↗
                    </a>
                  ) : (
                    <Button onClick={shareRx} disabled={rxSharing} variant="secondary">
                      {rxSharing ? 'Creating…' : 'Share prescription'}
                    </Button>
                  ))}
              </>
            )}
          </>
        ) : (
          <Button onClick={() => void sign()} disabled={signing}>
            {signing ? 'Signing…' : 'Confirm & sign'}
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
