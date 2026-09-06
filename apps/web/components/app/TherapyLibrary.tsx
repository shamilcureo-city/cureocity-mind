'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  TherapyScriptSchema,
  type ClinicalRecommendedTherapy,
  type TherapyScript,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { languageName } from '../../lib/language-names';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ShareModal } from './ShareModal';
import { MindTherapyGuide } from './MindTherapyGuide';

interface TherapyLibraryProps {
  clientId: string;
  /** Preserve the case rationale where the psychologist chooses an approach. */
  recommendedTherapies: ClinicalRecommendedTherapy[];
  /** Always-available fallback list for browse mode. */
  libraryTherapies: string[];
  defaultLanguage: 'en' | 'ml' | 'hi' | 'ta' | 'bn';
  /** Id of the client's currently active treatment plan, if any. */
  activeTreatmentPlanId: string | null;
  /// Sprint 43 — real contact availability so the share modal greys
  /// out channels the client can't receive on (was hardcoded `true`).
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  canShare?: boolean;
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
 * POST. Review navigation is saved separately from clinical content; neither
 * opening a step nor reviewing it records therapy delivery.
 */
export function TherapyLibrary({
  clientId,
  recommendedTherapies,
  libraryTherapies,
  defaultLanguage,
  activeTreatmentPlanId,
  clientHasContactPhone,
  clientHasContactEmail,
  canShare = false,
}: TherapyLibraryProps) {
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
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
      const currentRequest = ++requestId.current;
      setActiveTherapy(therapyName);
      setLoading(true);
      setError(null);
      setScriptData(null);
      try {
        const params = new URLSearchParams({ therapy: therapyName, language: defaultLanguage });
        if (refresh) params.set('refresh', '1');
        const res = await fetch(
          `/api/v1/clients/${clientId}/therapy-scripts?${params.toString()}`,
          { method: 'POST', cache: 'no-store' },
        );
        const data = (await res.json().catch(() => ({}))) as {
          script?: TherapyScript;
          source?: 'cache' | 'fresh';
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const parsed = TherapyScriptSchema.safeParse(data.script);
        if (!parsed.success) throw new Error('The guide could not be validated. Please try again.');
        if (requestId.current !== currentRequest) return;
        setScriptData({ script: parsed.data, source: data.source ?? 'fresh' });
      } catch (e) {
        if (requestId.current === currentRequest) setError((e as Error).message);
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    },
    [clientId, defaultLanguage],
  );

  const close = useCallback(() => {
    requestId.current += 1;
    setLoading(false);
    setActiveTherapy(null);
    setScriptData(null);
    setError(null);
  }, []);

  // De-dupe: a therapy that appears in both lists shows under
  // "Recommended" only.
  const visibleLibrary = useMemo(
    () =>
      libraryTherapies
        .filter((t) => !recommendedTherapies.some((item) => item.name === t))
        .map((name) => ({ name })),
    [libraryTherapies, recommendedTherapies],
  );

  return (
    <Card className="p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">Session guides</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Choose an approach to prepare a case-specific draft. Review its fit, then open your
            step-by-step companion. Your judgment leads the session.
          </p>
          <p className="mt-2 max-w-prose text-sm text-[var(--color-ink-2)]">
            These are AI drafts, not approved therapy protocols. A diagnosis is not required. Choose
            an approach within your training and review its suitability with the client.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canShare && activeTreatmentPlanId && (
            <Button
              variant="secondary"
              onClick={() =>
                setShareTarget({
                  kind: 'treatment-plan',
                  treatmentPlanId: activeTreatmentPlanId,
                })
              }
            >
              Share plan with client
            </Button>
          )}
          <Badge tone="muted">Guidance in {languageName(defaultLanguage)}</Badge>
        </div>
      </header>

      {activeTherapy === null ? (
        <div className="space-y-5">
          <TherapyList
            title="Suggested approaches to consider"
            empty="No suggestions yet. You can explore an approach below; a disorder diagnosis is not required to prepare a draft."
            therapies={recommendedTherapies}
            onPick={(t) => void loadScript(t)}
          />
          <TherapyList
            title="Explore the library"
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
            <p role="status" className="mt-4 text-sm text-[var(--color-ink-2)]">
              Preparing your draft guide…
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]"
            >
              <p>
                We could not confirm that the draft guide is ready. Retry to check for a saved draft
                or prepare it again.
              </p>
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => void loadScript(activeTherapy)}
              >
                Try again
              </Button>
              <details className="mt-3">
                <summary>Support details</summary>
                <p>{error}</p>
              </details>
            </div>
          )}
          {scriptData && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge tone="muted">
                  {scriptData.source === 'cache' ? 'Previously prepared draft' : 'New AI draft'}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadScript(activeTherapy, true)}
                    disabled={loading}
                  >
                    Prepare a fresh draft
                  </Button>
                  {canShare && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setShareTarget({
                          kind: 'therapy-script',
                          therapyScriptId: scriptData.script.id,
                          label: scriptData.script.therapyName,
                        })
                      }
                    >
                      Review client sharing
                    </Button>
                  )}
                </div>
              </div>
              <MindTherapyGuide
                key={scriptData.script.id + scriptData.script.updatedAt}
                script={scriptData.script.body}
                reviewTarget={{
                  clientId,
                  scriptId: scriptData.script.id,
                  scriptUpdatedAt: scriptData.script.updatedAt,
                }}
              />
              <p className="text-sm text-[var(--color-ink-2)]">
                Ready to use this draft? It will be selected for review in your session. Recording
                will not start automatically.
              </p>
              <Link
                className="inline-flex min-h-11 items-center rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
                href={`/app?record=${encodeURIComponent(clientId)}&capture=LIVE&guide=${encodeURIComponent(scriptData.script.id)}`}
              >
                Use this guide in a session
              </Link>
            </div>
          )}
        </div>
      )}
      {canShare && shareTarget && (
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
  therapies: { name: string; rationale?: string; evidenceSummary?: string; whenInPlan?: string }[];
  onPick: (t: string) => void;
}) {
  return (
    <section>
      <h3 className="text-sm font-medium text-[var(--color-ink-2)]">{title}</h3>
      {therapies.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">{empty}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {therapies.map((t) => (
            <li
              key={t.name}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-sm"
            >
              <h4 className="font-semibold">{t.name}</h4>
              {t.rationale && (
                <p className="leading-relaxed text-[var(--color-ink-2)]">{t.rationale}</p>
              )}
              {t.whenInPlan && (
                <p className="text-[var(--color-ink-2)]">Suggested timing: {t.whenInPlan}</p>
              )}
              {t.evidenceSummary && (
                <details className="text-[var(--color-ink-2)]">
                  <summary className="cursor-pointer font-medium">AI evidence summary</summary>
                  <p className="mt-2 leading-relaxed">{t.evidenceSummary}</p>
                  <p className="mt-2">
                    Check the supporting sources before using this as a clinical rationale.
                  </p>
                </details>
              )}
              <Button
                variant="secondary"
                className="mt-auto min-h-11"
                onClick={() => onPick(t.name)}
                aria-label={`Prepare draft guide: ${t.name}`}
              >
                Prepare draft guide
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
