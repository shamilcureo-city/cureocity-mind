'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ShareModal } from './ShareModal';

interface Props {
  sessionId: string;
  clientId: string;
  note: TherapyNoteV1;
  /// Sprint 43 — real contact availability so the share modal greys
  /// out channels the client can't receive on (was hardcoded `true`).
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}

interface Response {
  questions: string[];
  source: 'vertex' | 'mock';
  language?: string;
  model?: string;
  error?: string;
}

/**
 * Reflection Questions tab. Lists 5-7 client-facing questions derived
 * from the session's TherapyNoteV1 via a Vertex Gemini Pro call. The
 * therapist can copy a single question (to paste into a chat or handout
 * they already have open), copy the full set, or push the set through the
 * share flow with "Send to patient" (portal + WhatsApp / email).
 *
 * Loads on first mount and caches the response in component state —
 * the therapist can hit "Regenerate" to spend on a fresh set if the
 * first batch doesn't feel right.
 */
export function ReflectionTab({
  sessionId,
  clientId,
  note,
  clientHasContactPhone,
  clientHasContactEmail,
}: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/reflection-questions`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as Response;
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Which item last copied, so the click has visible confirmation.
   *
   * Copying used to be fire-and-forget (`void navigator.clipboard.writeText`),
   * which meant clicking "copy" produced no feedback whatsoever — and because
   * the rejected promise was swallowed, a genuine failure looked exactly like
   * a success. `navigator.clipboard` rejects on an insecure context (plain
   * http) and when the permission is denied, so that is a real case, not a
   * theoretical one.
   */
  const [copied, setCopied] = useState<number | 'all' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key: number | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(key);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(null);
      setCopyFailed(false);
    }, 1800);
  }, []);

  const copyAll = useCallback(() => {
    if (!data?.questions.length) return;
    const text = data.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    void copy(text, 'all');
  }, [data, copy]);

  return (
    <div className="space-y-4">
      <Card className="p-7">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Reflection questions</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {note.modality} session · derived from the signed note. Send to the client to hold
              between sessions.
            </p>
          </div>
          {data && (
            <div className="flex items-center gap-2">
              {data.language && data.language !== 'en' && (
                <Badge tone="muted">language: {data.language}</Badge>
              )}
              <Badge tone={data.source === 'vertex' ? 'accent' : 'muted'}>
                {data.source === 'vertex' ? `Vertex · ${data.model ?? 'gemini'}` : 'Mock'}
              </Badge>
            </div>
          )}
        </header>

        {loading && !data && (
          <p className="mt-6 text-sm text-[var(--color-ink-3)]">Generating questions…</p>
        )}
        {error && (
          <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
            {error}
          </div>
        )}

        {data && data.questions.length > 0 && (
          <ol className="mt-6 space-y-3">
            {data.questions.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4"
              >
                <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-xs font-medium text-white">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm leading-relaxed text-[var(--color-ink)]">{q}</span>
                <button
                  type="button"
                  onClick={() => void copy(q, i)}
                  title="Copy this question to paste into a chat or handout"
                  aria-label={`Copy question ${i + 1}`}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] ${
                    copied === i ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]'
                  }`}
                >
                  {copied === i ? 'Copied ✓' : 'Copy'}
                </button>
              </li>
            ))}
          </ol>
        )}

        {data && data.questions.length === 0 && !loading && (
          <p className="mt-6 text-sm text-[var(--color-ink-3)]">
            No questions were generated. Try regenerating.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] pt-5">
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? 'Generating…' : 'Regenerate'}
          </Button>
          {data && data.questions.length > 0 && (
            <>
              <Button variant="secondary" onClick={copyAll}>
                {copied === 'all' ? 'Copied ✓' : 'Copy all'}
              </Button>
              <Button onClick={() => setShareOpen(true)}>Send to patient</Button>
            </>
          )}
          {copyFailed && (
            <span className="text-xs text-[var(--color-warn)]">
              Couldn&rsquo;t reach the clipboard — select the text and copy manually.
            </span>
          )}
        </div>
      </Card>
      {data && data.questions.length > 0 && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          clientId={clientId}
          hasContactPhone={clientHasContactPhone}
          hasContactEmail={clientHasContactEmail}
          artefact={{
            artefactType: 'REFLECTION_QUESTIONS',
            sessionId,
            questions: data.questions,
          }}
          artefactLabel="Reflection questions"
        />
      )}
    </div>
  );
}
