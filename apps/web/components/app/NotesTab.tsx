'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  IntakeNoteV1,
  NoteDraft,
  SessionKind,
  TherapyNote,
  TherapyNoteV1,
} from '@cureocity/contracts';
import { IntakeNoteV1Schema } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { IntakeNotePreview } from './IntakeNotePreview';
import { NotePreview } from './NotePreview';
import { NoteEditor } from './NoteEditor';
import { IntakeNoteEditor } from './IntakeNoteEditor';
import { NoteToolbar } from './NoteToolbar';
import { TemplatePicker } from './TemplatePicker';
import { intakeNoteToText, therapyNoteToText } from '../../lib/note-text';
import { isBuiltinTemplateId, resolveBuiltinTemplate } from '../../lib/builtin-templates';
import {
  NOTE_VERBOSITIES,
  NOTE_VERBOSITY_LABEL,
  isNoteVerbosity,
  type NoteVerbosity,
} from '../../lib/note-format';
import { noteLanguageLabel } from '../../lib/note-languages';
import { LanguagePicker } from './LanguagePicker';
import { RiskBanner } from './RiskBanner';
import { AdvancementBanner } from './AdvancementBanner';
import { MockBackendBanner } from './MockBackendBanner';
import { RevisionPanel } from './RevisionPanel';
import { ShareModal } from './ShareModal';
import { HelpNote, InlineExplainer } from './EduHeading';
import { glossary } from '../../lib/clinical-glossary';
import { NoteReadiness } from './NoteReadiness';
import { checkIntakeNoteReadiness, checkTreatmentNoteReadiness } from '../../lib/note-readiness';
import { NoteReviewPanel } from './NoteReviewPanel';

type SessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED';

interface Props {
  sessionId: string;
  sessionStatus: SessionStatus;
  /// Sprint 19 — drives the discriminator for the note content
  /// (TherapyNoteV1 vs IntakeNoteV1) + which downstream surfaces are
  /// available (sign-off + modify panel are TherapyNote-only).
  sessionKind: SessionKind;
  initialDraft: NoteDraft | null;
  initialNote: TherapyNote | null;
  /// Sprint 71 — false when a signed note has been re-opened for editing,
  /// so the note renders in the editable (completed) state instead of signed.
  noteLocked: boolean;
  clientId: string;
  /// Sprint 43 — real contact availability so the share modal greys
  /// out channels the client can't receive on. Previously hardcoded
  /// `true`, which let a therapist try to WhatsApp a client with no
  /// phone on file and only learn it failed after submitting.
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  llmBackend: string;
  /// Sprint 70 — shown in the note toolbar (client chip + language flag).
  clientName: string;
  noteLanguage: string;
  /// Sprint 70 — the session's chosen note template (drives the picker +
  /// which structure Pass 2 writes the note into). Null = built-in SOAP.
  noteTemplateId: string | null;
}

type Phase =
  | { kind: 'awaiting-end'; status: SessionStatus }
  | { kind: 'ready-to-generate' }
  | { kind: 'generating'; draft: NoteDraft }
  // `reopened` marks a signed note that's been unlocked for editing (Sprint
  // 71). It edits in the "completed" state, but Template / Re-generate are
  // hidden — re-drafting from audio would discard the signed content — and
  // signing again re-locks rather than creating a fresh note.
  | { kind: 'completed'; draft: NoteDraft; reopened?: boolean }
  | { kind: 'signed'; note: TherapyNote }
  | { kind: 'failed'; draft: NoteDraft; error: string }
  | { kind: 'error'; message: string };

const POLL_MS = 2_000;

// How long a non-completing generation can sit before the UI offers a
// manual "Resume". A PENDING draft means /end created the row but the
// generation kick never landed (a navigation-aborted fire-and-forget),
// so surface recovery almost immediately. IN_PROGRESS means Gemini is
// genuinely running — but on Vercel the background pass can be killed
// without ever flipping the row to FAILED, so don't wait a full
// minute-and-a-half to offer recovery. Either way polling continues
// underneath, so a slow-but-fine run still auto-completes on its own
// and the Resume button is purely additive (re-kick is idempotent).
const STALL_PENDING_MS = 3_000;
const STALL_RUNNING_MS = 30_000;

export function NotesTab({
  sessionId,
  sessionStatus,
  sessionKind,
  initialDraft,
  initialNote,
  noteLocked,
  clientId,
  clientHasContactPhone,
  clientHasContactEmail,
  llmBackend,
  clientName,
  noteLanguage,
  noteTemplateId,
}: Props) {
  // Sign-off + AI modify-panel + share are TherapyNote-shaped. INTAKE
  // notes use IntakeNoteV1, which doesn't yet have a sign DTO or edit
  // surface. Render-only for v1.
  const isIntake = sessionKind === 'INTAKE';
  const [phase, setPhase] = useState<Phase>(() =>
    derivePhase(sessionStatus, initialDraft, initialNote, noteLocked),
  );
  const [generating, setGenerating] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  // View density for the note ("Detailed" dropdown in the toolbar). Per-device.
  const [verbosity, setVerbosity] = useState<NoteVerbosity>('DETAILED');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('cm.noteVerbosity');
      if (isNoteVerbosity(saved)) setVerbosity(saved);
    } catch {
      // localStorage unavailable — keep the default.
    }
  }, []);
  function pickVerbosity(v: NoteVerbosity): void {
    setVerbosity(v);
    try {
      window.localStorage.setItem('cm.noteVerbosity', v);
    } catch {
      // ignore
    }
  }
  const [shareOpen, setShareOpen] = useState(false);
  // Sharing requires a signed note, so a Share on an unsigned draft signs
  // first and then opens the share modal once the sign lands.
  const [pendingShare, setPendingShare] = useState(false);
  // The note's current display language (translated on demand from the
  // toolbar's language picker). Seeded from the session's output language.
  // Session-local on purpose: the translated *content* is persisted into the
  // draft, but this language tag is not written back to session.language — a
  // report translated to the client's language shouldn't silently change the
  // therapist's working language for other passes (e.g. the next pre-session
  // brief). So a reload re-seeds this from session.language; the persisted
  // note content stays in whatever language it was last translated to.
  const [noteLang, setNoteLang] = useState(noteLanguage);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // Direct manual edit of the draft note (pre-sign).
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Sprint 71 — re-opening a signed note for editing.
  const [unlocking, setUnlocking] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stall detection for the generating phase. `slow` latches true once
  // a run has sat past its threshold, flipping the spinner into a
  // recoverable state with a Resume button (instead of polling forever).
  const [slow, setSlow] = useState(false);
  const genStartRef = useRef<number | null>(null);
  const draftStatusRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollOnce = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note-draft`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        // End route hasn't created the row yet, or the session was never
        // ended — keep polling for a few ticks.
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Poll failed (${res.status})`);
      }
      const draft = (await res.json()) as NoteDraft;
      if (draft.status === 'COMPLETED' && draft.content) {
        setPhase({ kind: 'completed', draft });
        stopPolling();
      } else if (draft.status === 'FAILED') {
        setPhase({ kind: 'failed', draft, error: draft.errorMessage ?? 'Note generation failed.' });
        stopPolling();
      } else {
        setPhase({ kind: 'generating', draft });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
      stopPolling();
    }
  }, [sessionId, stopPolling]);

  // Manage the polling loop based on phase.
  useEffect(() => {
    if (phase.kind !== 'generating' && phase.kind !== 'awaiting-end') {
      stopPolling();
      return;
    }
    const tick = async (): Promise<void> => {
      await pollOnce();
      pollTimer.current = setTimeout(() => void tick(), POLL_MS);
    };
    pollTimer.current = setTimeout(() => void tick(), POLL_MS);
    return stopPolling;
  }, [phase.kind, pollOnce, stopPolling]);

  // Keep the latest draft status in a ref so the stall timer can read
  // it without restarting every poll tick.
  useEffect(() => {
    draftStatusRef.current = phase.kind === 'generating' ? phase.draft.status : null;
  }, [phase]);

  // Stall detector: while generating, latch `slow` once the run sits
  // past its status-dependent threshold. Keyed on phase.kind only so it
  // survives the per-tick phase updates from pollOnce.
  useEffect(() => {
    if (phase.kind !== 'generating') {
      genStartRef.current = null;
      setSlow(false);
      return;
    }
    if (genStartRef.current === null) genStartRef.current = Date.now();
    const id = setInterval(() => {
      setSlow((prev) => {
        if (prev) return true; // latched
        const elapsed = Date.now() - (genStartRef.current ?? Date.now());
        const threshold =
          draftStatusRef.current === 'IN_PROGRESS' ? STALL_RUNNING_MS : STALL_PENDING_MS;
        return elapsed > threshold;
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [phase.kind]);

  const triggerGeneration = useCallback(async (): Promise<void> => {
    setGenerating(true);
    // A fresh draft comes back in the session's original language, so reset
    // the language indicator (otherwise it would still claim the last
    // translated language).
    setNoteLang(noteLanguage);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/generate-note`, {
        method: 'POST',
      });
      if (!res.ok && res.status !== 500) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Generation failed (${res.status})`);
      }
      // The route returns the orchestrator result (COMPLETED or FAILED).
      // Either way, switch to polling so the UI reads the persisted state.
      await pollOnce();
      if (phase.kind === 'ready-to-generate') {
        setPhase({
          kind: 'generating',
          draft: {
            id: 'placeholder',
            sessionId,
            status: 'IN_PROGRESS',
            transcript: null,
            speakerSegments: null,
            affectFeatures: null,
            content: null,
            riskSeverity: null,
            totalCostInr: '0',
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }, [sessionId, pollOnce, phase.kind, noteLanguage]);

  // Manual recovery from a stalled run. Re-runs the orchestrator, which
  // is idempotent: it resets the draft to IN_PROGRESS and re-drafts from
  // the saved audio, so nothing the therapist recorded is lost.
  const resumeGeneration = useCallback((): void => {
    setSlow(false);
    genStartRef.current = Date.now();
    void triggerGeneration();
  }, [triggerGeneration]);

  const triggerSignOff = useCallback(async (): Promise<void> => {
    if (phase.kind !== 'completed') return;
    setSigning(true);
    setSignError(null);
    try {
      const note = phase.draft.content as TherapyNoteV1;
      const signedAt = new Date().toISOString();
      // Payload is the canonical JSON the server will SHA-256 to verify.
      // Stable ordering is left to the JSON.stringify defaults — the server
      // re-hashes whatever we send, so any deterministic string works as
      // long as the same bytes round-trip.
      const payload = JSON.stringify({ note, signedAt });
      const payloadHashHex = await sha256Hex(payload);
      const res = await fetch(`/api/v1/sessions/${sessionId}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload,
          payloadHashHex,
          note,
          edits: [],
          signedAt,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Sign failed (${res.status})`);
      }
      const signed = (await res.json()) as TherapyNote;
      setPhase({ kind: 'signed', note: signed });
    } catch (e) {
      setSignError((e as Error).message);
      setPendingShare(false);
    } finally {
      setSigning(false);
    }
  }, [phase, sessionId]);

  // Share from an unsigned draft: sign first, then open the share modal once
  // the sign lands (the share snapshot is built from the signed note).
  const signAndShare = useCallback((): void => {
    if (phase.kind === 'signed') {
      setShareOpen(true);
      return;
    }
    setPendingShare(true);
    void triggerSignOff();
  }, [phase.kind, triggerSignOff]);

  useEffect(() => {
    if (phase.kind === 'signed' && pendingShare) {
      setShareOpen(true);
      setPendingShare(false);
    }
  }, [phase.kind, pendingShare]);

  // Translate the completed draft into another language via the same
  // model-rewrite endpoint the AI panel uses (Vertex-only, pre-sign). The
  // translation is persisted into the draft, so sign + share carry it.
  const translateTo = useCallback(
    async (code: string): Promise<void> => {
      if (phase.kind !== 'completed' || code === noteLang || translating) return;
      const draft = phase.draft;
      const reopened = phase.reopened;
      const label = noteLanguageLabel(code);
      setTranslating(true);
      setTranslateError(null);
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/note/modify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instruction: `Translate every text field of this note into ${label}. Output all narrative text in ${label}, keeping the exact JSON structure, all clinical content, risk severity, and meaning identical. Translate only — do not add, remove, summarise, or re-interpret anything. Leave proper names unchanged.`,
          }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `Translation failed (${res.status})`);
        }
        // The modify route is kind-aware — it returns whichever shape it was
        // given (TherapyNoteV1 or IntakeNoteV1). Stored back as opaque draft
        // content so this path serves both note kinds.
        const b = (await res.json()) as { note: unknown };
        setPhase({
          kind: 'completed',
          draft: { ...draft, content: b.note as NoteDraft['content'] },
          reopened,
        });
        setNoteLang(code);
      } catch (e) {
        setTranslateError((e as Error).message);
      } finally {
        setTranslating(false);
      }
    },
    [phase, sessionId, noteLang, translating],
  );

  // Save a manual edit of the draft note (PUT note-draft). Kind-agnostic —
  // the route validates against IntakeNoteV1 / TherapyNoteV1 by session kind.
  // Works pre-sign and on a re-opened (unlocked) signed note.
  const saveEdit = useCallback(
    async (next: TherapyNoteV1 | IntakeNoteV1): Promise<void> => {
      if (phase.kind !== 'completed') return;
      const draft = phase.draft;
      const reopened = phase.reopened;
      setSavingEdit(true);
      setEditError(null);
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/note-draft`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: next }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `Save failed (${res.status})`);
        }
        const b = (await res.json()) as { note: unknown };
        setPhase({
          kind: 'completed',
          draft: { ...draft, content: b.note as NoteDraft['content'] },
          reopened,
        });
        setEditing(false);
      } catch (e) {
        setEditError((e as Error).message);
      } finally {
        setSavingEdit(false);
      }
    },
    [phase, sessionId],
  );

  // Re-open a signed note for editing: unlock server-side, then drop into the
  // editable "completed" state using the signed content as the draft.
  const unlockNote = useCallback(async (): Promise<void> => {
    if (phase.kind !== 'signed' || unlocking) return;
    const note = phase.note;
    setUnlocking(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/unlock`, { method: 'POST' });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Unlock failed (${res.status})`);
      }
      const content = note.content as unknown as NoteDraft['content'];
      const base: NoteDraft = initialDraft ?? {
        id: note.draftId,
        sessionId,
        status: 'COMPLETED',
        transcript: null,
        speakerSegments: null,
        affectFeatures: null,
        content,
        riskSeverity: null,
        totalCostInr: '0',
        errorMessage: null,
        createdAt: note.createdAt,
        updatedAt: note.createdAt,
      };
      setPhase({
        kind: 'completed',
        draft: { ...base, status: 'COMPLETED', content },
        reopened: true,
      });
      setNoteLang(noteLanguage);
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setUnlocking(false);
    }
  }, [phase, sessionId, unlocking, initialDraft, noteLanguage]);

  // Short label for the AI panel's document chip ("Note (BASE)"). For a
  // standard intake (no template) the chip reads "Initial assessment"; a
  // templated intake or a treatment note shows the chosen template's name.
  const templateLabel = resolveTemplateLabel(noteTemplateId);
  const aiDocLabel = isIntake && !noteTemplateId ? 'Initial assessment' : templateLabel;

  // ----- Render -----

  if (phase.kind === 'awaiting-end') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-xl">Session is still {phase.status.toLowerCase()}.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          End the recording from the Record page to release the audio for note generation.
        </p>
        <div className="mt-4">
          <Link
            href="/app"
            className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Back to Record
          </Link>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'ready-to-generate') {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-xl">Recording saved. Ready to write your note.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          We’ll turn the recording into a clear, written note for you. This usually takes 10–30
          seconds, and you can change anything before you save it.
        </p>
        <div className="mx-auto mt-5 max-w-md">
          <HelpNote title="Nothing is final yet">
            The note is just a first draft to save you typing. You stay in control — read it, edit
            it, and only you decide what it says.
          </HelpNote>
        </div>
        <div className="mt-5">
          <Button onClick={triggerGeneration} disabled={generating}>
            {generating ? 'Starting…' : 'Write my note'}
          </Button>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'generating') {
    return (
      <GeneratingState
        draft={phase.draft}
        slow={slow}
        resuming={generating}
        onResume={resumeGeneration}
      />
    );
  }

  if (phase.kind === 'failed') {
    return (
      <Card className="p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-serif text-xl text-[var(--color-warn)]">Note generation failed.</p>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-2)]">{phase.error}</p>
            {phase.error.toLowerCase().includes('cost') && (
              <p className="mt-3 max-w-md rounded-xl bg-[var(--color-warn-soft)] p-3 text-xs text-[var(--color-warn)]">
                The cost circuit tripped — this session would have exceeded the configured per-
                session or per-therapist monthly budget. Override by raising the cap in env vars
                <code className="mx-1 rounded bg-white/60 px-1 font-mono">
                  COST_CAP_PER_SESSION_INR
                </code>
                or
                <code className="mx-1 rounded bg-white/60 px-1 font-mono">
                  COST_CAP_PER_THERAPIST_MONTHLY_INR
                </code>
                .
              </p>
            )}
          </div>
          <Button onClick={triggerGeneration} disabled={generating}>
            {generating ? 'Retrying…' : 'Retry generation'}
          </Button>
        </div>
      </Card>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Card className="p-10">
        <p className="font-serif text-xl">Could not load the draft.</p>
        <p className="mt-2 text-sm text-[var(--color-warn)]">{phase.message}</p>
        <Button variant="secondary" onClick={() => void pollOnce()} className="mt-4">
          Try again
        </Button>
      </Card>
    );
  }

  if (phase.kind === 'signed') {
    const note = phase.note;
    // Signed notes share one layout for both kinds: the read-only note with
    // a Version-history block ("Edit note" → unlock → re-sign) on the left,
    // and the AI panel (disabled until re-opened) on the right.
    if (isIntake) {
      // Re-parse so a legacy/object-shaped mentalStatusExam is flattened to a
      // string before render. Fall back to the raw cast so a drifted row still
      // renders rather than throwing.
      const parsedIntake = IntakeNoteV1Schema.safeParse(note.content);
      const signedIntake = parsedIntake.success
        ? parsedIntake.data
        : (note.content as unknown as IntakeNoteV1);
      return (
        <>
          <MockBackendBanner llmBackend={llmBackend} />
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card className="p-7">
              <NoteToolbar
                sessionId={sessionId}
                clientName={clientName}
                noteText={intakeNoteToText(signedIntake)}
                signed
                onShare={() => setShareOpen(true)}
                leftControls={<VerbosityDropdown value={verbosity} onChange={pickVerbosity} />}
              />
              <RiskBanner riskFlags={signedIntake.riskFlags} />
              <IntakeNotePreview
                note={signedIntake}
                signedAt={note.signedAt}
                signedBy={note.signedBy}
                verbosity={verbosity}
              />
              <ShareModal
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                clientId={clientId}
                hasContactPhone={clientHasContactPhone}
                hasContactEmail={clientHasContactEmail}
                artefact={{ artefactType: 'SIGNED_INTAKE_NOTE', sessionId }}
                artefactLabel="Signed intake note"
              />
              <RevisionPanel sessionId={sessionId} onUnlock={unlockNote} unlocking={unlocking} />
              <NoteFooter
                costInr={initialDraft?.totalCostInr ?? '—'}
                chunkCount={initialDraft?.speakerSegments?.length ?? 0}
                transcriptChars={initialDraft?.transcript?.length ?? 0}
                region="signed"
              />
              <NoteReviewPanel sessionId={sessionId} />
            </Card>
            <ModifyPanel
              disabled={true}
              sessionId={sessionId}
              clientName={clientName}
              templateLabel={aiDocLabel}
            />
          </div>
        </>
      );
    }
    // Treatment branch — narrow the now-union content to TherapyNoteV1
    // (NotePreview, ModifyPanel, RevisionPanel all read SOAP fields).
    const treatmentContent = note.content as TherapyNoteV1;
    return (
      <>
        <MockBackendBanner llmBackend={llmBackend} />
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-7">
            <NoteToolbar
              sessionId={sessionId}
              clientName={clientName}
              noteText={therapyNoteToText(treatmentContent)}
              signed
              onShare={() => setShareOpen(true)}
              leftControls={<VerbosityDropdown value={verbosity} onChange={pickVerbosity} />}
            />
            <AdvancementBanner clientId={clientId} />
            <RiskBanner riskFlags={treatmentContent.riskFlags} />
            <NotePreview
              note={treatmentContent}
              signedAt={note.signedAt}
              signedBy={note.signedBy}
              verbosity={verbosity}
            />
            <ShareModal
              open={shareOpen}
              onClose={() => setShareOpen(false)}
              clientId={clientId}
              hasContactPhone={clientHasContactPhone}
              hasContactEmail={clientHasContactEmail}
              artefact={{ artefactType: 'SIGNED_NOTE', sessionId }}
              artefactLabel="Signed session note"
            />
            <RevisionPanel sessionId={sessionId} onUnlock={unlockNote} unlocking={unlocking} />
            <NoteFooter
              costInr={initialDraft?.totalCostInr ?? '—'}
              chunkCount={initialDraft?.speakerSegments?.length ?? 0}
              transcriptChars={initialDraft?.transcript?.length ?? 0}
              region="signed"
            />
            <NoteReviewPanel sessionId={sessionId} />
          </Card>
          <ModifyPanel
            disabled={true}
            sessionId={sessionId}
            clientName={clientName}
            templateLabel={aiDocLabel}
          />
        </div>
      </>
    );
  }

  // completed — intake. Mirrors the treatment completed layout minus the
  // template picker (intake is a fixed eight-section shape, no templates).
  if (isIntake) {
    const intakeNote = phase.draft.content as unknown as IntakeNoteV1;
    const reopened = phase.reopened ?? false;
    return (
      <>
        <MockBackendBanner llmBackend={llmBackend} />
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-7">
            <NoteToolbar
              sessionId={sessionId}
              clientName={clientName}
              noteText={intakeNoteToText(intakeNote)}
              signed={false}
              onShare={editing ? undefined : signAndShare}
              leftControls={
                <>
                  {/* Templates are opt-in for intake — the standard
                      initial-assessment format is the null-template default.
                      Hidden when re-opened (re-drafting would discard signed
                      content), same as treatment. */}
                  {!reopened && (
                    <TemplatePicker
                      sessionId={sessionId}
                      currentTemplateId={noteTemplateId}
                      kind="INTAKE"
                      disabled={generating || translating || editing}
                      onApply={triggerGeneration}
                    />
                  )}
                  <LanguagePicker
                    value={noteLang}
                    onChange={translateTo}
                    disabled={translating || generating || editing}
                  />
                  <VerbosityDropdown value={verbosity} onChange={pickVerbosity} />
                </>
              }
            />
            {translateError && (
              <p className="mb-4 text-xs text-[var(--color-warn)]">{translateError}</p>
            )}
            <RiskBanner riskFlags={intakeNote.riskFlags} />
            {editing ? (
              <IntakeNoteEditor
                note={intakeNote}
                saving={savingEdit}
                error={editError}
                onSave={saveEdit}
                onCancel={() => {
                  setEditing(false);
                  setEditError(null);
                }}
              />
            ) : (
              <>
                <IntakeNotePreview note={intakeNote} verbosity={verbosity} />
                <NoteFooter
                  costInr={phase.draft.totalCostInr}
                  chunkCount={phase.draft.speakerSegments?.length ?? 0}
                  transcriptChars={phase.draft.transcript?.length ?? 0}
                  region={llmBackend}
                />
                <NoteReadiness items={checkIntakeNoteReadiness(intakeNote)} />
                <NoteActions
                  signing={signing}
                  generating={generating}
                  translating={translating}
                  reopened={reopened}
                  signError={signError}
                  onSign={triggerSignOff}
                  onEdit={() => setEditing(true)}
                  onRegenerate={triggerGeneration}
                />
              </>
            )}
          </Card>
          <ModifyPanel
            disabled={false}
            busy={translating || editing}
            sessionId={sessionId}
            clientName={clientName}
            templateLabel={aiDocLabel}
            onModified={(next) =>
              setPhase({
                kind: 'completed',
                draft: { ...phase.draft, content: next as NoteDraft['content'] },
                reopened,
              })
            }
          />
        </div>
      </>
    );
  }

  // completed — treatment.
  const note = phase.draft.content as TherapyNoteV1;
  const reopened = phase.reopened ?? false;
  return (
    <>
      <MockBackendBanner llmBackend={llmBackend} />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-7">
          <NoteToolbar
            sessionId={sessionId}
            clientName={clientName}
            noteText={therapyNoteToText(note)}
            signed={false}
            onShare={editing ? undefined : signAndShare}
            leftControls={
              <>
                {/* Template / Re-generate re-draft from audio, which would
                    discard a re-opened signed note — so hide the picker there. */}
                {!reopened && (
                  <TemplatePicker
                    sessionId={sessionId}
                    currentTemplateId={noteTemplateId}
                    disabled={generating || translating || editing}
                    onApply={triggerGeneration}
                  />
                )}
                <LanguagePicker
                  value={noteLang}
                  onChange={translateTo}
                  disabled={translating || generating || editing}
                />
                <VerbosityDropdown value={verbosity} onChange={pickVerbosity} />
              </>
            }
          />
          {translateError && (
            <p className="mb-4 text-xs text-[var(--color-warn)]">{translateError}</p>
          )}
          <RiskBanner riskFlags={note.riskFlags} />
          {editing ? (
            <NoteEditor
              note={note}
              saving={savingEdit}
              error={editError}
              onSave={saveEdit}
              onCancel={() => {
                setEditing(false);
                setEditError(null);
              }}
            />
          ) : (
            <>
              <NotePreview note={note} verbosity={verbosity} />
              <NoteFooter
                costInr={phase.draft.totalCostInr}
                chunkCount={phase.draft.speakerSegments?.length ?? 0}
                transcriptChars={phase.draft.transcript?.length ?? 0}
                region={llmBackend}
              />
              <NoteReadiness items={checkTreatmentNoteReadiness(note)} />
              <NoteActions
                signing={signing}
                generating={generating}
                translating={translating}
                reopened={reopened}
                signError={signError}
                onSign={triggerSignOff}
                onEdit={() => setEditing(true)}
                onRegenerate={triggerGeneration}
              />
            </>
          )}
        </Card>
        <ModifyPanel
          disabled={false}
          busy={translating || editing}
          sessionId={sessionId}
          clientName={clientName}
          templateLabel={aiDocLabel}
          onModified={(next) =>
            setPhase({
              kind: 'completed',
              draft: { ...phase.draft, content: next as NoteDraft['content'] },
              reopened,
            })
          }
        />
      </div>
    </>
  );
}

function GeneratingState({
  draft,
  slow,
  resuming,
  onResume,
}: {
  draft: NoteDraft;
  slow: boolean;
  resuming: boolean;
  onResume: () => void;
}) {
  const steps = [
    { key: 'PENDING', label: 'Getting started' },
    { key: 'IN_PROGRESS', label: 'Turning speech into a note' },
    { key: 'COMPLETED', label: 'Ready for you' },
  ] as const;
  const idx = steps.findIndex((s) => s.key === draft.status);
  return (
    <Card className="p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-serif text-xl">
            <span className="inline-block animate-pulse">●</span> Writing your note…
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Turning the recording into a clear, written note. This usually takes 10–30 seconds.
          </p>
        </div>
        <Badge tone="warn">{draft.status.replace(/_/g, ' ').toLowerCase()}</Badge>
      </div>
      <ol className="mt-6 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li
              key={s.key}
              className={`rounded-xl border px-4 py-3 text-sm ${
                done
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : active
                    ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                    : 'border-[var(--color-line)] bg-white text-[var(--color-ink-3)]'
              }`}
            >
              <span className="text-xs font-medium uppercase tracking-wider">Step {i + 1}</span>
              <span className="mt-1 block">{s.label}</span>
            </li>
          );
        })}
      </ol>

      {slow && (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <p className="text-sm font-medium text-[var(--color-ink)]">
            This is taking longer than usual.
          </p>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-2)]">
            The hand-off to note generation may have been interrupted. Your recording and transcript
            are saved — resuming re-drafts the note from the saved audio. Nothing you recorded is
            lost.
          </p>
          <div className="mt-3">
            <Button onClick={onResume} disabled={resuming}>
              {resuming ? 'Resuming…' : 'Resume generation'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The Sign / Edit / Re-generate action row + sign-off explainer, shared by
 * the completed treatment and intake notes so they stay byte-identical. A
 * re-opened (unlocked) signed note hides Re-generate and re-labels Sign as
 * "re-lock", and swaps the first-timer explainer for a re-lock hint.
 */
function NoteActions({
  signing,
  generating,
  translating,
  reopened,
  signError,
  onSign,
  onEdit,
  onRegenerate,
}: {
  signing: boolean;
  generating: boolean;
  translating: boolean;
  reopened: boolean;
  signError: string | null;
  onSign: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
}) {
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] pt-5">
        <Button onClick={onSign} disabled={signing}>
          {signing ? 'Signing…' : reopened ? 'Sign & re-lock' : 'Sign off'}
        </Button>
        <Button variant="secondary" onClick={onEdit} disabled={translating}>
          Edit note
        </Button>
        {!reopened && (
          <Button variant="secondary" onClick={onRegenerate} disabled={generating}>
            Re-generate
          </Button>
        )}
        {signError && <span className="text-sm text-[var(--color-warn)]">{signError}</span>}
      </div>
      {reopened ? (
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          You re-opened a signed note. Make your changes, then Sign again to re-lock it — each
          version you save is kept in the history below.
        </p>
      ) : (
        <div className="mt-3">
          <InlineExplainer
            entry={glossary('action.sign')}
            label="New here? See what “sign off” does"
          />
        </div>
      )}
    </>
  );
}

/** Compact "Detailed ▾" view-density dropdown for the note toolbar. */
function VerbosityDropdown({
  value,
  onChange,
}: {
  value: NoteVerbosity;
  onChange: (v: NoteVerbosity) => void;
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Detail level</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as NoteVerbosity)}
        className="appearance-none rounded-full border border-[var(--color-line)] bg-white py-1.5 pl-3.5 pr-8 text-sm font-medium text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
      >
        {NOTE_VERBOSITIES.map((v) => (
          <option key={v} value={v}>
            {NOTE_VERBOSITY_LABEL[v]}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3 text-[var(--color-ink-3)]">
        ▾
      </span>
    </label>
  );
}

function NoteFooter({
  costInr,
  chunkCount,
  transcriptChars,
  region,
}: {
  costInr: string;
  chunkCount: number;
  transcriptChars: number;
  region: string;
}) {
  return (
    <details className="mt-6 border-t border-[var(--color-line-soft)] pt-4 text-xs text-[var(--color-ink-3)]">
      <summary className="cursor-pointer select-none font-medium text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]">
        Session details
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cost" value={costInr === '—' ? '—' : `₹${costInr}`} />
        <Stat label="Audio segments" value={String(chunkCount)} />
        <Stat label="Characters" value={`${transcriptChars} characters`} />
        <Stat label="Mode" value={region} />
      </dl>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 font-mono text-[13px] text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

type SuggestKind = 'paragraph' | 'eye-off' | 'concise' | 'expand';

const QUICK_INSTRUCTIONS: { label: string; icon: SuggestKind }[] = [
  { label: 'Change to paragraph format', icon: 'paragraph' },
  { label: 'Remove all client names', icon: 'eye-off' },
  { label: 'Make more concise', icon: 'concise' },
  { label: 'Expand the plan with concrete steps', icon: 'expand' },
];

/**
 * The note's AI side panel — a chat-style "modify your note" surface
 * matching the reference: a "New chat" header, suggestion chips, a centred
 * prompt with a document-context chip, and a composer with a Send button.
 * Submitting (a chip or typed instruction) calls the note/modify endpoint;
 * the model only rewrites existing SOAP content, it doesn't invent any.
 */
function ModifyPanel({
  disabled,
  busy,
  sessionId,
  clientName,
  templateLabel,
  onModified,
}: {
  disabled: boolean;
  /** Another note-mutating op (e.g. a translation) is in flight — gate
   *  edits so two concurrent /note/modify calls can't clobber each other. */
  busy?: boolean;
  sessionId: string;
  clientName: string;
  /** Document-context chip label ("BASE", a template name, or "Intake note"). */
  templateLabel: string;
  /** Kind-agnostic: the /note/modify route returns whichever shape it was
   *  given, so this serves both treatment (SOAP) and intake notes. */
  onModified?: (next: TherapyNoteV1 | IntakeNoteV1) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChanged, setLastChanged] = useState<string[] | null>(null);
  const blocked = disabled || Boolean(busy);

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() || disabled || busy || !onModified) return;
      setPending(true);
      setError(null);
      setLastChanged(null);
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/note/modify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instruction: text }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          note: TherapyNoteV1 | IntakeNoteV1;
          changedFields: string[];
        };
        onModified(body.note);
        setLastChanged(body.changedFields);
        setInstruction('');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPending(false);
      }
    },
    [disabled, busy, onModified, sessionId],
  );

  function reset(): void {
    setInstruction('');
    setError(null);
    setLastChanged(null);
  }

  return (
    <Card className="flex h-full flex-col p-5">
      {/* Header — New chat / clear */}
      <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] pb-3">
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]"
        >
          New chat
          <span aria-hidden className="text-xs text-[var(--color-ink-3)]">
            ▾
          </span>
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Clear chat"
          className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
        >
          <PanelIcon kind="close" />
        </button>
      </div>

      {/* Conversation area — feedback + quick suggestions */}
      <div className="flex flex-1 flex-col justify-end gap-3 py-6">
        {disabled && (
          <p className="text-center text-xs text-[var(--color-ink-3)]">
            This note is signed. Use “Edit note” in the Version history below to change it.
          </p>
        )}
        {lastChanged && lastChanged.length > 0 && (
          <p className="rounded-xl bg-[var(--color-accent-soft)] px-3 py-2 text-xs text-[var(--color-accent)]">
            Updated: {lastChanged.join(', ')}
          </p>
        )}
        {lastChanged && lastChanged.length === 0 && (
          <p className="text-xs text-[var(--color-ink-3)]">
            No changes were needed — try a more specific instruction.
          </p>
        )}
        {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}

        {!disabled && (
          <div className="grid gap-2">
            {QUICK_INSTRUCTIONS.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={pending || blocked}
                onClick={() => void submit(q.label)}
                className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-left text-sm text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
              >
                <span className="text-[var(--color-ink-3)]">
                  <PanelIcon kind={q.icon} />
                </span>
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Composer — prompt + document chip + input */}
      <div>
        <p className="text-center text-base font-semibold text-[var(--color-ink)]">
          How would you like to modify your note?
        </p>
        <div className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs text-[var(--color-ink-2)]">
            <PanelIcon kind="doc" />
            {clientName} — Note ({templateLabel})
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(instruction);
          }}
          className="mt-3 rounded-2xl border border-[var(--color-line)] bg-white p-3"
        >
          <input
            type="text"
            placeholder={
              disabled
                ? 'Signed — use “Edit note” below'
                : busy
                  ? 'Translating…'
                  : pending
                    ? 'Modifying…'
                    : 'Make modifications to your note here'
            }
            disabled={blocked || pending}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            className="w-full bg-transparent text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)]"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-ink-3)]">
              <PanelIcon kind="doc" />
              {templateLabel}
            </span>
            <button
              type="submit"
              disabled={blocked || pending || instruction.trim().length < 3}
              aria-label="Send"
              className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              <PanelIcon kind="send" />
            </button>
          </div>
        </form>
        <p className="mt-3 text-center text-[11px] text-[var(--color-ink-3)]">
          The AI only rewrites — it won’t invent clinical content. Severity + modality are
          preserved.
        </p>
      </div>
    </Card>
  );
}

/** Line-icons for the AI panel (suggestion chips + composer controls). */
function PanelIcon({ kind }: { kind: SuggestKind | 'close' | 'doc' | 'send' }) {
  const paths: Record<SuggestKind | 'close' | 'doc' | 'send', string> = {
    paragraph: 'M4 6h16M4 10h16M4 14h10M4 18h7',
    'eye-off':
      'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.83 2.83M9.4 5.2A9 9 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2 2.6M5.2 7.3A12 12 0 0 0 3 12c0 2.5 4 7 9 7a9 9 0 0 0 2.3-.3',
    concise: 'M4 9h12M4 13h16M4 17h8',
    expand: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5',
    close: 'M6 6l12 12M18 6L6 18',
    doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
    send: 'M12 19V5M5 12l7-7 7 7',
  };
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

/** A short label for the AI panel's document chip — "BASE" for the
 *  built-in SOAP default, otherwise the chosen template's name. */
function resolveTemplateLabel(noteTemplateId: string | null): string {
  if (!noteTemplateId) return 'BASE';
  if (isBuiltinTemplateId(noteTemplateId)) {
    return resolveBuiltinTemplate(noteTemplateId)?.name ?? 'Template';
  }
  return 'Template';
}

function derivePhase(
  sessionStatus: SessionStatus,
  draft: NoteDraft | null,
  note: TherapyNote | null,
  noteLocked: boolean,
): Phase {
  if (note && noteLocked) return { kind: 'signed', note };
  // Sprint 71 — an unlocked signed note edits in the "completed" state; the
  // draft was synced to the signed content on unlock. `reopened` keeps the
  // focused-edit affordances (no Template / Re-generate) on reload too.
  if (note && !noteLocked && draft?.status === 'COMPLETED' && draft.content) {
    return { kind: 'completed', draft, reopened: true };
  }
  if (note) return { kind: 'signed', note };
  if (draft?.status === 'COMPLETED' && draft.content) return { kind: 'completed', draft };
  if (draft?.status === 'FAILED') {
    return { kind: 'failed', draft, error: draft.errorMessage ?? 'Note generation failed.' };
  }
  if (draft && (draft.status === 'PENDING' || draft.status === 'IN_PROGRESS')) {
    return { kind: 'generating', draft };
  }
  if (sessionStatus === 'COMPLETED') return { kind: 'ready-to-generate' };
  return { kind: 'awaiting-end', status: sessionStatus };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
