'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AgreementSpeaker,
  AllianceRating,
  CaseFormulationV1,
  FormulationSuggestion,
  SessionAgreementDto,
  SessionKind,
  TherapyNote,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { postSignNote } from '../../lib/sign-note';
import { formatIstDateTime } from '../../lib/ist';
import { ShareModal } from './ShareModal';

/**
 * The Session Loop (SL1) — "Close the loop", the five-moment end-of-session
 * ritual that replaces scattered post-session admin with one surface:
 *
 *   1. What happened   — the note, already drafted; you glance, not write.
 *   2. What it means   — the living formulation + the AI's evidence-anchored
 *                        proposed updates (accept = new version).
 *   3. What we agreed  — the session's agreements, in the client's words
 *                        where possible; next session's Prepare reads these.
 *   4. Is it working   — latest measure + trend, and the one-tap alliance
 *                        read (drift shows here before it shows in scores).
 *   5. Anything to watch — crisis flags + the open assessment questions.
 *
 * …then ONE signature. Everything above is covered by the same sign-off the
 * note already required — no second ceremony, no extra admin.
 */

export interface CloseLoopMeasurePoint {
  instrumentKey: string;
  score: number;
  severity: string;
  administeredAt: string;
}

export interface CloseLoopCrisisFlag {
  kind: string;
  severity: string;
  recommendedAction: string;
}

export interface CloseLoopData {
  sessionId: string;
  clientId: string;
  clientName: string;
  sessionKind: SessionKind;
  sessionCompleted: boolean;
  hasContactPhone: boolean;
  hasContactEmail: boolean;
  preferredLanguage: string;
  /** Moment 1 — the note. */
  noteReady: boolean;
  noteContent: unknown | null;
  noteSummary: string | null;
  signed: { signedAt: string; signerName: string } | null;
  /** Moment 2 — the formulation. */
  reportId: string | null;
  suggestions: FormulationSuggestion[];
  formulation: { version: number; confirmedAt: string; body: CaseFormulationV1 } | null;
  /** Moment 3 — agreements. */
  agreements: SessionAgreementDto[];
  /** Moment 4 — measures + alliance. */
  measures: CloseLoopMeasurePoint[];
  alliance: AllianceRating | null;
  /** Moment 5 — watch. */
  crisisFlags: CloseLoopCrisisFlag[];
  openQuestions: string[];
}

const ALLIANCE_OPTIONS: { key: AllianceRating; label: string; hint: string }[] = [
  { key: 'ROUGH', label: 'Rough', hint: 'strained today' },
  { key: 'FLAT', label: 'Flat', hint: 'went through the motions' },
  { key: 'GOOD', label: 'Good', hint: 'connected' },
  { key: 'STRONG', label: 'Strong', hint: 'real work happened' },
];

const TARGET_LABEL: Record<FormulationSuggestion['target'], string> = {
  NARRATIVE: 'Narrative',
  CYCLE: 'Maintaining cycle',
  PREDISPOSING: 'Predisposing',
  PRECIPITATING: 'Precipitating',
  PERPETUATING: 'Perpetuating',
  PROTECTIVE: 'Protective',
  PREDICTION: 'Prediction',
};

export function CloseLoopBoard({ data }: { data: CloseLoopData }) {
  const router = useRouter();
  const isIntake = data.sessionKind === 'INTAKE';

  // ----- moment 2: formulation suggestions -----
  const [acceptedIdx, setAcceptedIdx] = useState<Set<number>>(new Set());
  const [suggestionBusy, setSuggestionBusy] = useState<number | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const acceptSuggestion = useCallback(
    async (index: number): Promise<void> => {
      if (!data.reportId) return;
      setSuggestionBusy(index);
      setSuggestionError(null);
      try {
        const res = await fetch(`/api/v1/clients/${data.clientId}/formulation`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'accept',
            reportId: data.reportId,
            suggestionIndex: index,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not update the formulation (${res.status})`);
        }
        setAcceptedIdx((prev) => new Set(prev).add(index));
        router.refresh();
      } catch (e) {
        setSuggestionError((e as Error).message);
      } finally {
        setSuggestionBusy(null);
      }
    },
    [data.clientId, data.reportId, router],
  );

  // ----- moment 3: agreements -----
  const [agreements, setAgreements] = useState<SessionAgreementDto[]>(data.agreements);
  const [agreementText, setAgreementText] = useState('');
  const [agreementSpeaker, setAgreementSpeaker] = useState<AgreementSpeaker>('CLIENT');
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  const addAgreement = useCallback(async (): Promise<void> => {
    const text = agreementText.trim();
    if (!text) return;
    setAgreementBusy(true);
    setAgreementError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${data.sessionId}/agreements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, speaker: agreementSpeaker }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not record the agreement (${res.status})`);
      }
      const body = (await res.json()) as { agreement: SessionAgreementDto };
      setAgreements((prev) => [...prev, body.agreement]);
      setAgreementText('');
    } catch (e) {
      setAgreementError((e as Error).message);
    } finally {
      setAgreementBusy(false);
    }
  }, [agreementText, agreementSpeaker, data.sessionId]);

  const removeAgreement = useCallback(
    async (agreementId: string): Promise<void> => {
      setAgreementError(null);
      const prev = agreements;
      setAgreements((cur) => cur.filter((a) => a.id !== agreementId));
      const res = await fetch(`/api/v1/sessions/${data.sessionId}/agreements/${agreementId}`, {
        method: 'DELETE',
      }).catch(() => null);
      if (!res || !res.ok) {
        setAgreements(prev);
        setAgreementError('Could not remove the agreement — try again.');
      }
    },
    [agreements, data.sessionId],
  );

  // ----- moment 4: alliance -----
  const [alliance, setAlliance] = useState<AllianceRating | null>(data.alliance);
  const [allianceError, setAllianceError] = useState<string | null>(null);

  const rateAlliance = useCallback(
    async (rating: AllianceRating): Promise<void> => {
      setAllianceError(null);
      const prev = alliance;
      setAlliance(rating);
      const res = await fetch(`/api/v1/sessions/${data.sessionId}/feedback`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alliance: rating }),
      }).catch(() => null);
      if (!res || !res.ok) {
        setAlliance(prev);
        setAllianceError('Could not save — try again.');
      }
    },
    [alliance, data.sessionId],
  );

  // ----- the signature -----
  const [signed, setSigned] = useState(data.signed);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const triggerSign = useCallback(async (): Promise<void> => {
    if (!data.noteContent) return;
    setSigning(true);
    setSignError(null);
    try {
      const note = data.noteContent;
      const signedAt = new Date().toISOString();
      const payload = JSON.stringify({ note, signedAt });
      const payloadHashHex = await sha256Hex(payload);
      const res = await postSignNote(data.sessionId, {
        payload,
        payloadHashHex,
        note,
        edits: [],
        signedAt,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Sign failed (${res.status})`);
      }
      const signedNote = (await res.json()) as TherapyNote;
      setSigned({ signedAt: signedNote.signedAt, signerName: '' });
      router.refresh();
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setSigning(false);
    }
  }, [data.noteContent, data.sessionId, router]);

  // Latest + previous score per instrument, from the newest-first series.
  const measureRows = useMemo(() => {
    const byKey = new Map<string, CloseLoopMeasurePoint[]>();
    for (const m of data.measures) {
      const list = byKey.get(m.instrumentKey) ?? [];
      list.push(m);
      byKey.set(m.instrumentKey, list);
    }
    return Array.from(byKey.entries()).map(([key, list]) => ({
      instrumentKey: key,
      latest: list[0]!,
      previous: list[1] ?? null,
    }));
  }, [data.measures]);

  const notesHref = `/app/sessions/${data.sessionId}?tab=notes`;
  const visibleSuggestions = data.suggestions
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !acceptedIdx.has(i));

  return (
    <div className="space-y-4">
      {/* 1 · What happened */}
      <MomentCard n={1} title="What happened" hint="The note is drafted — glance, don't write.">
        {data.noteReady && data.noteSummary ? (
          <>
            <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">{data.noteSummary}</p>
            <Link
              href={notesHref}
              className="mt-2 inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              Read or edit the full note →
            </Link>
          </>
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">
            {data.sessionCompleted ? (
              <>
                The note hasn&apos;t been generated yet.{' '}
                <Link
                  href={notesHref}
                  className="font-medium text-[var(--color-accent)] hover:underline"
                >
                  Generate it on the Notes tab →
                </Link>
              </>
            ) : (
              'The note appears here once the session ends.'
            )}
          </p>
        )}
      </MomentCard>

      {/* 2 · What it means */}
      <MomentCard
        n={2}
        title="What it means"
        hint="The living formulation — why this persists, and what today changed."
      >
        {data.formulation ? (
          <FormulationSnapshot
            version={data.formulation.version}
            confirmedAt={data.formulation.confirmedAt}
            body={data.formulation.body}
          />
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">
            No formulation yet — <span className="font-medium">still forming</span> is a valid
            state. Accept a proposed update below to start it, or author it as the picture settles.
          </p>
        )}

        {visibleSuggestions.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              Proposed updates from this session
            </p>
            {visibleSuggestions.map(({ s, i }) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--color-line-soft)] bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{TARGET_LABEL[s.target]}</Badge>
                  <Badge tone="muted">{s.action === 'ADD' ? 'add' : 'revise'}</Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--color-ink)]">{s.text}</p>
                {s.evidenceQuote && (
                  <p className="mt-1.5 border-l-2 border-[var(--color-line)] pl-2 text-xs italic text-[var(--color-ink-3)]">
                    &ldquo;{s.evidenceQuote}&rdquo;
                  </p>
                )}
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void acceptSuggestion(i)}
                    disabled={suggestionBusy !== null}
                  >
                    {suggestionBusy === i ? 'Updating…' : 'Accept into formulation'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {acceptedIdx.size > 0 && (
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            {acceptedIdx.size} update{acceptedIdx.size > 1 ? 's' : ''} accepted — the formulation is
            now v{(data.formulation?.version ?? 0) + acceptedIdx.size}.
          </p>
        )}
        {suggestionError && <ErrorLine text={suggestionError} />}
        {data.formulation === null && visibleSuggestions.length === 0 && acceptedIdx.size === 0 && (
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            No proposed updates from this session.
          </p>
        )}
      </MomentCard>

      {/* 3 · What we agreed */}
      <MomentCard
        n={3}
        title="What we agreed"
        hint="In the client's words where possible — next session opens with these."
      >
        {agreements.length > 0 ? (
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-line-soft)] bg-white p-3"
              >
                <div>
                  <p className="text-sm text-[var(--color-ink)]">
                    {a.speaker === 'CLIENT' ? <>&ldquo;{a.text}&rdquo;</> : a.text}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">
                    {a.speaker === 'CLIENT' ? "client's words" : 'therapist'}
                  </p>
                </div>
                {!signed && (
                  <button
                    type="button"
                    onClick={() => void removeAgreement(a.id)}
                    className="shrink-0 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                    aria-label="Remove agreement"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">
            Nothing recorded yet. One or two kept agreements beat five forgotten ones.
          </p>
        )}

        {!signed && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SpeakerChip
                active={agreementSpeaker === 'CLIENT'}
                onClick={() => setAgreementSpeaker('CLIENT')}
                label="Client's words"
              />
              <SpeakerChip
                active={agreementSpeaker === 'THERAPIST'}
                onClick={() => setAgreementSpeaker('THERAPIST')}
                label="Mine"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={agreementText}
                onChange={(e) => setAgreementText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addAgreement();
                  }
                }}
                maxLength={500}
                placeholder={
                  agreementSpeaker === 'CLIENT'
                    ? 'e.g. "I\'ll text Priya before Saturday, even if I don\'t feel like it"'
                    : 'e.g. Bring the sleep diary next session'
                }
                className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void addAgreement()}
                disabled={agreementBusy || agreementText.trim() === ''}
              >
                {agreementBusy ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        )}
        {agreementError && <ErrorLine text={agreementError} />}
      </MomentCard>

      {/* 4 · Is it working */}
      <MomentCard
        n={4}
        title="Is it working"
        hint="The measure says one thing; how the room felt says another. Both count."
      >
        {measureRows.length > 0 ? (
          <ul className="space-y-1.5">
            {measureRows.map((row) => (
              <li key={row.instrumentKey} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium text-[var(--color-ink)]">
                  {instrumentLabel(row.instrumentKey)}
                </span>
                <span className="text-[var(--color-ink-2)]">
                  {row.latest.score} · {row.latest.severity.toLowerCase().replace(/_/g, ' ')}
                </span>
                {row.previous && (
                  <span className="text-xs text-[var(--color-ink-3)]">
                    {delta(row.latest.score, row.previous.score)} since{' '}
                    {formatIstDateTime(new Date(row.previous.administeredAt)).split(',')[0]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-ink-2)]">
            No scored measures yet — administer one from the Progress tab when it fits the work.
          </p>
        )}

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            How did the session land?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALLIANCE_OPTIONS.map((o) => {
              const active = alliance === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => void rateAlliance(o.key)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-accent)]'
                  }`}
                  aria-pressed={active}
                  title={o.hint}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
            Your read, one tap — alliance drift shows here before it shows in the scores.
          </p>
          {allianceError && <ErrorLine text={allianceError} />}
        </div>
      </MomentCard>

      {/* 5 · Anything to watch */}
      <MomentCard n={5} title="Anything to watch" hint="Safety first; open questions second.">
        {data.crisisFlags.length === 0 && data.openQuestions.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-2)]">
            Nothing flagged this session, and no open assessment questions.
          </p>
        ) : (
          <div className="space-y-3">
            {data.crisisFlags.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3"
              >
                <p className="text-sm font-medium text-[var(--color-ink)]">
                  {f.kind.replace(/_/g, ' ')} · {f.severity} severity
                </p>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">{f.recommendedAction}</p>
              </div>
            ))}
            {data.openQuestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                  Still open to ask
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-2)]">
                  {data.openQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </MomentCard>

      {/* One signature */}
      <Card className="p-5">
        {signed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">
                Session closed{signed.signerName ? ` — signed by ${signed.signerName}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                {formatIstDateTime(new Date(signed.signedAt))} · the note, agreements and
                formulation updates above are on the record.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShareOpen(true)}>
              Share with {data.clientName.split(' ')[0]}…
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">One signature closes it</p>
              <p className="mt-0.5 max-w-xl text-xs text-[var(--color-ink-3)]">
                Signing covers the note above — agreements, the alliance read and accepted
                formulation updates are already saved as you go. You can share the summary right
                after.
              </p>
            </div>
            <Button onClick={() => void triggerSign()} disabled={!data.noteReady || signing}>
              {signing ? 'Signing…' : 'Sign and close'}
            </Button>
          </div>
        )}
        {!data.noteReady && !signed && (
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            Signing needs the note — generate it on the{' '}
            <Link href={notesHref} className="font-medium text-[var(--color-accent)]">
              Notes tab
            </Link>{' '}
            first.
          </p>
        )}
        {signError && <ErrorLine text={signError} />}
      </Card>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        clientId={data.clientId}
        hasContactPhone={data.hasContactPhone}
        hasContactEmail={data.hasContactEmail}
        artefact={
          isIntake
            ? { artefactType: 'SIGNED_INTAKE_NOTE', sessionId: data.sessionId }
            : { artefactType: 'SIGNED_NOTE', sessionId: data.sessionId }
        }
        artefactLabel={isIntake ? 'Signed intake summary' : 'Session summary'}
        defaultLanguage={data.preferredLanguage}
      />
    </div>
  );
}

// ----- pieces -----

function MomentCard({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-baseline gap-3">
        <span className="flex h-6 w-6 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
          {n}
        </span>
        <div>
          <h3 className="font-serif text-lg text-[var(--color-ink)]">{title}</h3>
          <p className="text-xs text-[var(--color-ink-3)]">{hint}</p>
        </div>
      </div>
      <div className="mt-3 pl-9 max-sm:pl-0">{children}</div>
    </Card>
  );
}

function FormulationSnapshot({
  version,
  confirmedAt,
  body,
}: {
  version: number;
  confirmedAt: string;
  body: CaseFormulationV1;
}) {
  const psCount =
    body.fivePs.predisposing.length +
    body.fivePs.precipitating.length +
    body.fivePs.perpetuating.length +
    body.fivePs.protective.length;
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Formulation v{version}</Badge>
        <span className="text-[11px] text-[var(--color-ink-3)]">
          confirmed {formatIstDateTime(new Date(confirmedAt))}
        </span>
      </div>
      {body.narrative && (
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{body.narrative}</p>
      )}
      {body.cycle.length > 0 && (
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          <span className="font-semibold uppercase tracking-[0.1em]">Cycle</span>{' '}
          {body.cycle.map((c) => c.text).join(' → ')}
        </p>
      )}
      {(psCount > 0 || body.predictions.length > 0) && (
        <p className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">
          {psCount} factor{psCount === 1 ? '' : 's'} across the five Ps
          {body.predictions.length > 0 &&
            ` · ${body.predictions.length} prediction${body.predictions.length === 1 ? '' : 's'} being tested`}
        </p>
      )}
    </div>
  );
}

function SpeakerChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
          : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)]'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <p className="mt-2 text-xs text-[var(--color-warn)]">{text}</p>;
}

function instrumentLabel(instrumentKey: string): string {
  return instrumentKey === 'PHQ9' ? 'PHQ-9' : instrumentKey === 'GAD7' ? 'GAD-7' : instrumentKey;
}

function delta(latest: number, previous: number): string {
  const d = latest - previous;
  if (d === 0) return 'unchanged';
  return d < 0 ? `↓ ${Math.abs(d)} pts` : `↑ ${d} pts`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
