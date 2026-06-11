'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  TherapyScript,
  TherapyScriptStep,
  TherapyScriptV1,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ShareModal } from './ShareModal';

interface TherapyLibraryProps {
  clientId: string;
  /** Names of therapies the active ClinicalReport recommended. May be empty. */
  recommendedTherapies: string[];
  /** Always-available fallback list for browse mode. */
  libraryTherapies: string[];
  defaultLanguage: 'en' | 'ml' | 'hi' | 'ta' | 'bn';
  /** Id of the client's currently active treatment plan, if any. */
  activeTreatmentPlanId: string | null;
  /// Sprint 43 — real contact availability so the share modal greys
  /// out channels the client can't receive on (was hardcoded `true`).
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}

interface ScriptResponse {
  script: TherapyScript;
  source: 'cache' | 'fresh';
}

/**
 * Sprint 14 — Therapy Library on the client detail page.
 *
 * Lists therapies grouped by source (recommended vs. library), each
 * a clickable button that opens the Script Player. The Player loads
 * a TherapyScriptV1 via the cached `/api/v1/clients/[id]/therapy-scripts`
 * GET. Step progress is held in component state (no server-side
 * persistence in V1 — that's a Sprint 14 follow-up).
 */
export function TherapyLibrary({
  clientId,
  recommendedTherapies,
  libraryTherapies,
  defaultLanguage,
  activeTreatmentPlanId,
  clientHasContactPhone,
  clientHasContactEmail,
}: TherapyLibraryProps) {
  const [activeTherapy, setActiveTherapy] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<
    | null
    | { kind: 'therapy-script'; therapyScriptId: string; label: string }
    | { kind: 'treatment-plan'; treatmentPlanId: string }
  >(null);

  const loadScript = useCallback(
    async (therapyName: string, refresh = false) => {
      setActiveTherapy(therapyName);
      setLoading(true);
      setError(null);
      setScriptData(null);
      try {
        const params = new URLSearchParams({ therapy: therapyName });
        if (refresh) params.set('refresh', '1');
        const res = await fetch(
          `/api/v1/clients/${clientId}/therapy-scripts?${params.toString()}`,
          { cache: 'no-store' },
        );
        const data = (await res.json().catch(() => ({}))) as
          | { script?: TherapyScript; source?: 'cache' | 'fresh'; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!data.script) throw new Error('Empty response');
        setScriptData({ script: data.script, source: data.source ?? 'fresh' });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [clientId],
  );

  const close = useCallback(() => {
    setActiveTherapy(null);
    setScriptData(null);
    setError(null);
  }, []);

  // De-dupe: a therapy that appears in both lists shows under
  // "Recommended" only.
  const visibleLibrary = useMemo(
    () => libraryTherapies.filter((t) => !recommendedTherapies.includes(t)),
    [libraryTherapies, recommendedTherapies],
  );

  return (
    <Card className="p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">Therapy library</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Click a therapy to load a step-by-step in-session script tailored to this client's
            diagnosis + plan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTreatmentPlanId && (
            <Button
              variant="secondary"
              onClick={() =>
                setShareTarget({
                  kind: 'treatment-plan',
                  treatmentPlanId: activeTreatmentPlanId,
                })
              }
            >
              Share plan with patient
            </Button>
          )}
          <Badge tone="muted">language: {defaultLanguage}</Badge>
        </div>
      </header>

      {activeTherapy === null ? (
        <div className="space-y-5">
          <TherapyList
            title="Recommended for this client"
            empty="No clinical brief yet — accept a diagnosis and plan to surface recommendations."
            therapies={recommendedTherapies}
            onPick={(t) => void loadScript(t)}
          />
          <TherapyList
            title="General library"
            empty="No library therapies configured."
            therapies={visibleLibrary}
            onPick={(t) => void loadScript(t)}
          />
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl">{activeTherapy}</h3>
            <button
              type="button"
              onClick={close}
              className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              ← back to library
            </button>
          </div>
          {loading && (
            <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading script…</p>
          )}
          {error && (
            <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
              {error}
            </div>
          )}
          {scriptData && (
            <ScriptPlayer
              script={scriptData.script.body}
              source={scriptData.source}
              onRefresh={() => void loadScript(activeTherapy, true)}
              refreshing={loading}
              onShare={() =>
                setShareTarget({
                  kind: 'therapy-script',
                  therapyScriptId: scriptData.script.id,
                  label: scriptData.script.therapyName,
                })
              }
            />
          )}
        </div>
      )}
      {shareTarget && (
        <ShareModal
          open={shareTarget !== null}
          onClose={() => setShareTarget(null)}
          clientId={clientId}
          hasContactPhone={clientHasContactPhone}
          hasContactEmail={clientHasContactEmail}
          artefact={
            shareTarget.kind === 'therapy-script'
              ? {
                  artefactType: 'THERAPY_SCRIPT',
                  therapyScriptId: shareTarget.therapyScriptId,
                }
              : {
                  artefactType: 'TREATMENT_PLAN',
                  treatmentPlanId: shareTarget.treatmentPlanId,
                }
          }
          artefactLabel={
            shareTarget.kind === 'therapy-script'
              ? `Therapy script · ${shareTarget.label}`
              : 'Treatment plan'
          }
        />
      )}
    </Card>
  );
}

function TherapyList({
  title,
  empty,
  therapies,
  onPick,
}: {
  title: string;
  empty: string;
  therapies: string[];
  onPick: (t: string) => void;
}) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{title}</h3>
      {therapies.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">{empty}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {therapies.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => onPick(t)}
                className="w-full rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-left text-sm hover:border-[var(--color-ink)]"
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================================
// ScriptPlayer — checklist UI for one TherapyScriptV1.
// ============================================================================

interface ScriptPlayerProps {
  script: TherapyScriptV1;
  source: 'cache' | 'fresh';
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  onShare: () => void;
}

function ScriptPlayer({ script, source, onRefresh, refreshing, onShare }: ScriptPlayerProps) {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});

  const toggleStep = useCallback((id: string) => {
    setCompleted((m) => ({ ...m, [id]: !m[id] }));
  }, []);
  const toggleBranches = useCallback((id: string) => {
    setExpandedBranches((m) => ({ ...m, [id]: !m[id] }));
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      // Map ISO 639-1 to BCP-47-ish lang code. Web Speech accepts
      // 2-letter codes for most browsers; fall back to en if absent.
      utter.lang = mapLang(script.language);
      utter.rate = 1.0;
      window.speechSynthesis.speak(utter);
    },
    [script.language],
  );

  const totalSteps = script.mainExercise.steps.length;
  const doneCount = script.mainExercise.steps.filter((s) => completed[s.id]).length;

  return (
    <div className="mt-4 space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line-soft)] pb-3">
        <div>
          <p className="text-sm text-[var(--color-ink-2)]">
            ~{script.estimatedDurationMin} min · {totalSteps} steps · {doneCount} done
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={source === 'fresh' ? 'accent' : 'muted'}>{source}</Badge>
          <Button variant="secondary" onClick={() => void onRefresh()} disabled={refreshing}>
            {refreshing ? 'Regenerating…' : 'Regenerate'}
          </Button>
          <Button onClick={onShare}>Send to patient</Button>
        </div>
      </header>

      <ScriptBlock title="Opening (first 2-3 minutes)" text={script.openingScript} onSpeak={speak} />

      <section>
        <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Main exercise</h4>
        <ol className="mt-3 space-y-3">
          {script.mainExercise.steps.map((step, i) => (
            <StepCard
              key={step.id}
              step={step}
              index={i + 1}
              done={!!completed[step.id]}
              branchesOpen={!!expandedBranches[step.id]}
              onToggleDone={() => toggleStep(step.id)}
              onToggleBranches={() => toggleBranches(step.id)}
              onSpeak={speak}
            />
          ))}
        </ol>
      </section>

      {script.adaptationCues.length > 0 && (
        <section className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4">
          <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Adaptation cues
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-2)]">
            {script.adaptationCues.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {script.riskWatchpoints.length > 0 && (
        <section className="rounded-xl border-2 border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4">
          <h4 className="text-xs uppercase tracking-wide text-[var(--color-warn)]">
            Risk watchpoints — pause + safety-check if any surface
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-2)]">
            {script.riskWatchpoints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <ScriptBlock title="Closing (last 3-5 minutes)" text={script.closingScript} onSpeak={speak} />

      <section className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4">
        <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Homework</h4>
        <p className="mt-2 text-sm text-[var(--color-ink)]">{script.homework.description}</p>
        <p className="mt-2 text-xs italic text-[var(--color-ink-3)]">
          Delivery: {script.homework.deliveryNotes}
        </p>
      </section>
    </div>
  );
}

function StepCard({
  step,
  index,
  done,
  branchesOpen,
  onToggleDone,
  onToggleBranches,
  onSpeak,
}: {
  step: TherapyScriptStep;
  index: number;
  done: boolean;
  branchesOpen: boolean;
  onToggleDone: () => void;
  onToggleBranches: () => void;
  onSpeak: (text: string) => void;
}) {
  return (
    <li
      className={`rounded-xl border p-4 transition-colors ${
        done
          ? 'border-[var(--color-line-soft)] bg-[var(--color-accent-soft)] opacity-80'
          : 'border-[var(--color-line-soft)] bg-white/40'
      }`}
    >
      <header className="flex items-start gap-3">
        <label className="mt-0.5 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={done}
            onChange={onToggleDone}
            className="h-4 w-4 rounded border-[var(--color-line)]"
            aria-label={`mark step ${index} done`}
          />
        </label>
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className={`text-sm ${done ? 'line-through' : ''}`}>
              {index}. {step.purpose}
            </strong>
            <button
              type="button"
              onClick={() => onSpeak(step.therapistSays)}
              className="rounded-full px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            >
              read aloud
            </button>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-ink)]">
            {step.therapistSays}
          </p>
          <p className="mt-2 text-xs italic text-[var(--color-ink-3)]">
            Listen for: {step.listenFor}
          </p>
          {step.branches.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onToggleBranches}
                className="text-xs text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
              >
                {branchesOpen ? '− hide' : `+ show ${step.branches.length}`} branch
                {step.branches.length === 1 ? '' : 'es'}
              </button>
              {branchesOpen && (
                <ul className="mt-2 space-y-2 border-l-2 border-[var(--color-line-soft)] pl-3">
                  {step.branches.map((b, i) => (
                    <li key={i} className="text-xs">
                      <p className="text-[var(--color-ink-3)]">If client says: {b.ifClientSays}</p>
                      <p className="mt-1 text-[var(--color-ink)]">→ {b.thenDo}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </header>
    </li>
  );
}

function ScriptBlock({
  title,
  text,
  onSpeak,
}: {
  title: string;
  text: string;
  onSpeak: (text: string) => void;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-line-soft)] bg-white/30 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{title}</h4>
        <button
          type="button"
          onClick={() => onSpeak(text)}
          className="rounded-full px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          read aloud
        </button>
      </header>
      <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-ink)]">{text}</p>
    </section>
  );
}

function mapLang(lang: string): string {
  switch (lang) {
    case 'ml':
      return 'ml-IN';
    case 'hi':
      return 'hi-IN';
    case 'ta':
      return 'ta-IN';
    case 'bn':
      return 'bn-IN';
    default:
      return 'en-IN';
  }
}
