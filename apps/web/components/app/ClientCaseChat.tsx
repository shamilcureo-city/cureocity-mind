'use client';

import { useState } from 'react';

interface Props {
  clientId: string;
  clientName: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What would help me not commit to a plan too early?',
  'What is the single most important question to ask next session?',
  'Summarise the differential in two lines.',
];

/**
 * Sprint 22 — client-aware chat embedded in the Case Briefing. Posts
 * to the practice-assistant route with this client's id so the
 * assistant reasons over the one cumulative record (same synthesis
 * the workspace shows).
 */
export function ClientCaseChat({ clientId, clientName }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/v1/practice-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, messages: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      setMessages([
        ...next,
        { role: 'assistant', content: body.reply ?? body.error ?? 'No response.' },
      ]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-4">
      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              disabled={busy}
              className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <li key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <span
                className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-white text-[var(--color-ink)]'
                }`}
              >
                {m.content}
              </span>
            </li>
          ))}
          {busy && <li className="text-xs text-[var(--color-ink-3)]">Thinking…</li>}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${clientName}…`}
          className="flex-1 rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
