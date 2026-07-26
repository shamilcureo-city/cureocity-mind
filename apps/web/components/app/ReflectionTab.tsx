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
 * therapist can copy the full set, or push it through the share flow
 * with "Send to patient" (portal + WhatsApp / email).
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
   * Copy confirmation. Not fire-and-forget: `navigator.clipboard` rejects
   * on an insecure context (plain http) and when the permission is denied,
   * so a genuine failure must look different from a success.
   */
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyAll = useCallback(async () => {
    if (!data?.questions.length) return;
    const text = data.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1800);
  }, [data]);

  return (
    <div className="space-y-4">
      <Card className="p-7">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Reflection questions</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {note.modality} session · derived from the signed note.
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
              <Button variant="secondary" onClick={() => void copyAll()}>
                {copied ? 'Copied ✓' : 'Copy all'}
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
