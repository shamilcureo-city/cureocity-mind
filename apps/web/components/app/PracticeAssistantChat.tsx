'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_QUESTIONS = [
  'How is my caseload looking this week?',
  'Which clients haven’t been seen in 30+ days?',
  'Summarize my recent high-risk sessions.',
  'What should I prepare for tomorrow’s sessions?',
];

/**
 * Practice Assistant chat UI. Holds a message thread in component
 * state (no server-side persistence in V1 — the conversation lives
 * only for the lifetime of the page). Posts the rolling history to
 * /api/v1/practice-assistant/chat which builds a fresh practice-
 * snapshot system prompt on every turn, so context drift between
 * turns is bounded by what the model retains in its window plus the
 * server-supplied snapshot.
 */
export function PracticeAssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the thread on new messages.
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, pending]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;
      const next: Message[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(next);
      setInput('');
      setPending(true);
      setError(null);
      try {
        const res = await fetch('/api/v1/practice-assistant/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { reply: string; model: string };
        setMessages((prev) => [...prev, { role: 'assistant', content: body.reply }]);
        setModel(body.model);
      } catch (e) {
        setError((e as Error).message);
        // Roll back the user message so the input isn't lost on error.
        setMessages((prev) => prev.slice(0, -1));
        setInput(trimmed);
      } finally {
        setPending(false);
      }
    },
    [messages, pending],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  return (
    <Card className="flex h-[70vh] flex-col p-0">
      <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-6 py-3">
        <span className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Conversation
        </span>
        {model && (
          <Badge tone={model === 'mock' ? 'muted' : 'accent'}>
            {model === 'mock' ? 'Mock backend' : `Vertex · ${model}`}
          </Badge>
        )}
      </div>

      <div
        ref={threadRef}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="grid place-items-center pt-8 text-center">
            <p className="max-w-md text-sm text-[var(--color-ink-2)]">
              Ask anything about your practice. The data the assistant sees is your roster, recent
              sessions, active workflows, and upcoming bookings.
            </p>
            <div className="mt-6 grid w-full max-w-lg gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={pending}
                  className="rounded-2xl border border-[var(--color-line)] bg-white px-4 py-3 text-left text-sm text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-60"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'bg-[var(--color-surface-soft)] text-[var(--color-ink)]'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-3)]">
              Thinking…
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-[var(--color-line-soft)] px-6 py-4">
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-line)] bg-white p-2">
          <input
            type="text"
            placeholder={pending ? 'Thinking…' : 'Ask anything about your practice'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            className="flex-1 bg-transparent px-2 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)]"
          />
          <button
            type="submit"
            disabled={pending || input.trim().length < 2}
            aria-label="Send"
            className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            ↑
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          The assistant only sees your own clinical data. Conversations are not persisted across
          page reloads.
        </p>
      </form>
    </Card>
  );
}
