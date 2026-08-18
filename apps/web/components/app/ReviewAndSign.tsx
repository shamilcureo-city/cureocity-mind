'use client';

import { useState, type ReactNode } from 'react';
import type { MedicalEncounterNoteV1, RxPadDraft } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { MedicalNoteView } from './MedicalNoteView';
import { MedicalNoteEditor, type NoteFieldEdit } from './MedicalNoteEditor';
import { VitalsEntryCard } from './VitalsEntryCard';
import { PlanComposer } from './PlanComposer';
import { EncounterDifferentialPanel } from './EncounterDifferentialPanel';
import { EncounterOrdersPanel } from './EncounterOrdersPanel';
import { EncounterInteropPanel } from './EncounterInteropPanel';
import { postSignNote } from '../../lib/sign-note';

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
  examined,
  notExamined,
  onSigned,
}: {
  sessionId: string;
  /** Needed for patient shares; when absent the share buttons hide. */
  clientId?: string | undefined;
  note: MedicalEncounterNoteV1;
  /** Optional slot above the note (the live page's "consult ended" line). */
  header?: ReactNode;
  /**
   * DS11.6-fu — the live exam ledger. `examined` = copilot suggestions the
   * doctor marked ✓ done; `notExamined` = suggested-but-declined-or-untouched.
   * Only the live path passes these (batch/dictate have no live exam prompts);
   * absent/empty → the disclosure hides.
   */
  examined?: string[] | undefined;
  notExamined?: string[] | undefined;
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
  const [signedRxPad, setSignedRxPad] = useState<RxPadDraft | null>(null);
  const [rxShareUrl, setRxShareUrl] = useState<string | null>(null);
  const [rxSharing, setRxSharing] = useState(false);
  // Batch B — prescription-safety gate. `hard` = a drug that conflicts with a
  // recorded allergy (overridable with a recorded reason); `soft` = med rows
  // still awaiting a confirm tap (cleared by confirming or removing them).
  const [blockers, setBlockers] = useState<{ hard: string[]; soft: string[] }>({
    hard: [],
    soft: [],
  });
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  // Batch C — the note is CORRECTABLE before it is signed. `working` is what
  // gets signed; `edits` is the before/after trail of what the clinician
  // changed, persisted as NoteEdit rows alongside the signature.
  const [working, setWorking] = useState<MedicalEncounterNoteV1>(note);
  const [edits, setEdits] = useState<NoteFieldEdit[]>([]);
  const [editing, setEditing] = useState(false);
  const overriding = blockers.hard.length > 0;
  const blocked =
    !signed && (blockers.soft.length > 0 || (overriding && overrideReason.trim().length < 3));

  // Sign-off. A doctor with a registered WebAuthn credential is required
  // to assert (same rule as the therapist sign route). The note is signed
  // as-drafted (no field edits in this MVP).
  async function sign(): Promise<void> {
    setSigning(true);
    setSignError(null);
    try {
      const signedAt = new Date().toISOString();
      const res = await postSignNote(sessionId, {
        note: working,
        draftContent: note,
        edits,
        signedAt,
        rxPad: signedRxPad,
        // Batch B — signing past a drug-allergy contraindication is allowed,
        // but never silent: the reason rides along and lands one
        // RX_SAFETY_OVERRIDE audit row atomic with the signature.
        ...(overriding && overrideReason.trim()
          ? { safetyOverride: { reason: overrideReason.trim(), blockers: blockers.hard } }
          : {}),
      });
      if (!res.ok) {
        const message = await errorOf(res, 'Could not sign the note');
        if (
          res.status === 409 &&
          (message === 'Therapy note already signed for this session' ||
            message === 'Note was signed concurrently; reload and review the saved signature')
        ) {
          setSigned(true);
          onSigned?.();
          return;
        }
        throw new Error(message);
      }
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
        {editing ? (
          <MedicalNoteEditor
            note={working}
            baseline={note}
            onCancel={() => setEditing(false)}
            onSave={(next, changed) => {
              setWorking(next);
              // Re-editing accumulates against the ORIGINAL draft, so the
              // trail always reads "what the AI wrote → what was signed",
              // never a chain of intermediate keystrokes.
              setEdits(changed);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <MedicalNoteView note={working} />
            {!signed && (
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-line-soft)] pt-4">
                <p className="text-xs text-[var(--color-ink-3)]">
                  {edits.length === 0
                    ? 'This note was drafted by AI from the consult. Correct anything that is wrong before you sign it.'
                    : `You corrected ${edits.length === 1 ? '1 section' : `${edits.length} sections`}. The change is recorded with your signature.`}
                </p>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  Edit note
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      {/* DS11.6-fu — the honest exam ledger. A copilot exam suggestion the
          doctor never marked done is disclosed here, not silently dropped.
          Wording is deliberately factual (no judgement) — pending clinician
          sign-off before pilot per the DS11 risk note. */}
      {((examined && examined.length > 0) || (notExamined && notExamined.length > 0)) && (
        <Card className="space-y-2 p-5">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-ink-3)]">
            Examination
          </p>
          {examined && examined.length > 0 && (
            <p className="text-sm text-[var(--color-ink-2)]">
              <span className="font-medium text-[var(--color-accent)]">Examined:</span>{' '}
              {examined.join(', ')}
            </p>
          )}
          {notExamined && notExamined.length > 0 && (
            <p className="text-sm text-[var(--color-ink-2)]">
              <span className="font-medium text-[var(--color-warn)]">
                Suggested but not examined:
              </span>{' '}
              {notExamined.join(', ')}
            </p>
          )}
        </Card>
      )}
      {/* Batch F — vitals measured at triage, typed in. */}
      {!signed && <VitalsEntryCard sessionId={sessionId} />}
      {/* Sprint DS10-B — two plans, one sign-off. */}
      <PlanComposer
        sessionId={sessionId}
        signed={signed}
        onPadChange={(hasContent, pad) => {
          setHasRx(hasContent);
          setSignedRxPad(pad);
        }}
        onSignBlockers={setBlockers}
      />
      <EncounterDifferentialPanel sessionId={sessionId} />
      <EncounterOrdersPanel sessionId={sessionId} />
      <EncounterInteropPanel sessionId={sessionId} />

      {/* Batch B — the prescription-safety gate. A signature is a clinical
          act; it must not be the step where an allergy conflict or an
          unconfirmed drug slips through. */}
      {!signed && (blockers.hard.length > 0 || blockers.soft.length > 0) && (
        <Card className="border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-5 text-sm">
          {blockers.hard.length > 0 && (
            <div className="text-[var(--color-warn)]">
              <strong className="block">
                This prescription conflicts with a recorded allergy.
              </strong>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {blockers.hard.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-2">
                Remove or change the drug, or — if this is deliberate (a mislabeled allergy, a
                desensitised patient, a considered risk/benefit call) — record why. Your reason is
                stored with the signature.
              </p>
              {overrideOpen ? (
                <label className="mt-3 block">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Reason for prescribing anyway
                  </span>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white p-2 text-sm text-[var(--color-ink)]"
                    placeholder="e.g. Allergy label is a childhood GI upset, not a true hypersensitivity — discussed with patient."
                  />
                </label>
              ) : (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setOverrideOpen(true)}
                  type="button"
                >
                  Prescribe anyway — record my reason
                </Button>
              )}
            </div>
          )}
          {blockers.soft.length > 0 && (
            <div className={blockers.hard.length > 0 ? 'mt-4 text-[var(--color-ink-2)]' : ''}>
              <strong className="block text-[var(--color-ink)]">
                {blockers.soft.length === 1
                  ? '1 prescription line is not confirmed yet.'
                  : `${blockers.soft.length} prescription lines are not confirmed yet.`}
              </strong>
              <p className="mt-1">
                Confirm or remove {blockers.soft.join(', ')} in the plan above. Nothing is
                prescribed until you confirm it.
              </p>
            </div>
          )}
        </Card>
      )}

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
          <Button onClick={() => void sign()} disabled={signing || blocked}>
            {signing ? 'Signing…' : overriding ? 'Sign with recorded reason' : 'Confirm & sign'}
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
