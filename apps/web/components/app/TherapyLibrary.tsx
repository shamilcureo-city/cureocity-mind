'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TherapyScriptSchema, type TherapyScript } from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { languageName } from '../../lib/language-names';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ShareModal } from './ShareModal';
import { MindTherapyGuide } from './MindTherapyGuide';

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
 * POST. Guide-review navigation is held in component state (no server-side
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
    () => libraryTherapies.filter((t) => !recommendedTherapies.includes(t)),
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
          {loading && <p className="mt-4 text-sm text-[var(--color-ink-3)]">Loading script…</p>}
          {error && (
            <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
              {error}
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
              />
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
  therapies: string[];
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
            <li key={t}>
              <button
                type="button"
                onClick={() => onPick(t)}
                className="group flex min-h-20 w-full items-center justify-between gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4 text-left text-sm transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
              >
                <span>{t}</span>
                <span aria-hidden="true" className="text-lg text-[var(--color-accent)]">
                  ↗
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
