'use client';

import { useState } from 'react';
import { LETTER_KIND_LABELS, type Letter, type LetterKind } from '@cureocity/contracts';

/**
 * Sprint 66 — compose a referral / supporting letter.
 *
 * A small modal: pick the kind, set the addressee, add an optional note,
 * Generate. The body is composed server-side from the case record; on
 * success the therapist downloads the credential-stamped PDF.
 */
const KINDS: LetterKind[] = ['REFERRAL', 'ATTENDANCE', 'FITNESS', 'SUPPORT'];

export function LetterComposer({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LetterKind>('REFERRAL');
  const [recipient, setRecipient] = useState('To whom it may concern');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Letter | null>(null);

  function reset(): void {
    setKind('REFERRAL');
    setRecipient('To whom it may concern');
    setNote('');
    setError(null);
    setCreated(null);
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/letters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, recipient, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { letter?: Letter; error?: string };
      if (!res.ok || !data.letter) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCreated(data.letter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-block rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
      >
        Write a letter
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
          <div className="w-[min(34rem,100%)] rounded-2xl border border-[var(--color-line)] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl">Write a letter</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                ✕
              </button>
            </div>

            {created ? (
              <div className="mt-5">
                <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-accent-soft)]/40 px-4 py-3 text-sm">
                  <p className="font-medium text-[var(--color-ink)]">
                    Letter ready: {created.subject}
                  </p>
                  <p className="mt-0.5 text-[var(--color-ink-2)]">
                    Composed from the client&apos;s record. Download it, then review before you
                    send.
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`/api/v1/clients/${clientId}/letters/${created.id}/pdf`}
                    className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
                  >
                    Download PDF
                  </a>
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  >
                    Write another
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    Type of letter
                  </label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKind(k)}
                        className={`rounded-xl border px-3 py-2 text-left text-sm ${
                          kind === k
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                            : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]'
                        }`}
                      >
                        {LETTER_KIND_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    Addressed to
                  </label>
                  <input
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder={
                      kind === 'REFERRAL' ? 'e.g. Dr. A. Sharma' : 'To whom it may concern'
                    }
                    className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white p-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    Anything to add? (optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="A line in your own words to include in the letter."
                    className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white p-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>

                {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}

                <p className="text-xs text-[var(--color-ink-3)]">
                  The letter is drafted from this client&apos;s record. Always read it before
                  sending.
                </p>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={pending || recipient.trim().length === 0}
                    className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                  >
                    {pending ? 'Composing…' : 'Generate letter'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
