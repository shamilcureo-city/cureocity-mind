'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ShareModal } from './ShareModal';

interface Props {
  sessionId: string;
  clientId: string;
  note: TherapyNoteV1;
}

interface Response {
  questions: string[];
  source: 'vertex' | 'mock';
  model?: string;
  error?: string;
}

/**
 * Reflection Questions tab. Lists 5-7 client-facing questions derived
 * from the session's TherapyNoteV1 via a Vertex Gemini Pro call. The
 * therapist can copy individual questions or the full set to send to
 * the client (handout / WhatsApp / email).
 *
 * Loads on first mount and caches the response in component state —
 * the therapist can hit "Regenerate" to spend on a fresh set if the
 * first batch doesn't feel right.
 */
export function ReflectionTab({ sessionId, clientId, note }: Props) {
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

  const copyAll = useCallback(async () => {
    if (!data?.questions.length) return;
    const text = data.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    await navigator.clipboard.writeText(text);
  }, [data]);

  return (
    <div className="space-y-4">
      <Card className="p-7">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Reflection questions</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {note.modality} session · derived from the signed note. Send to the client to
              hold between sessions.
            </p>
          </div>
          {data && (
            <Badge tone={data.source === 'vertex' ? 'accent' : 'muted'}>
              {data.source === 'vertex' ? `Vertex · ${data.model ?? 'gemini'}` : 'Mock'}
            </Badge>
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
                  onClick={() => void navigator.clipboard.writeText(q)}
                  className="rounded-full px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                >
                  copy
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
                Copy all
              </Button>
              <Button onClick={() => setShareOpen(true)}>Send to patient</Button>
            </>
          )}
        </div>
      </Card>
      {data && data.questions.length > 0 && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          clientId={clientId}
          hasContactPhone={true}
          hasContactEmail={true}
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
