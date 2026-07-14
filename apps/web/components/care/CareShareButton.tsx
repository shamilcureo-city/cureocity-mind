'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * CG6 — mint + share a pride-shaped card. The server builds everything;
 * this component only picks the kind, then offers the native share sheet
 * (wa.me-friendly), copy, and one-tap revoke. Never auto-posts anywhere.
 */
export function CareShareButton({
  kind,
  label,
}: {
  kind: 'MILESTONE' | 'VERDICT' | 'GRADUATION';
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/care/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Could not make the card');
      const full = `${window.location.origin}${body.url}`;
      setUrl(full);
      setToken(body.token ?? null);
      if (navigator.share) {
        await navigator.share({ url: full }).catch(() => undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    if (!token) return;
    await fetch(`/api/v1/care/share?token=${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    setUrl(null);
    setToken(null);
  }

  if (url) {
    return (
      <div className="text-sm">
        <p className="break-all text-[13px] text-[var(--color-ink-2)]">{url}</p>
        <div className="mt-1.5 flex gap-3">
          <button
            type="button"
            className="font-semibold text-[var(--color-accent)]"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            type="button"
            className="text-[var(--color-ink-3)] underline-offset-2 hover:underline"
            onClick={() => void revoke()}
          >
            Take it down
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void create()}>
        {busy ? 'Making it…' : label}
      </Button>
      {error ? <p className="mt-1 text-xs text-[var(--color-warn)]">{error}</p> : null}
    </div>
  );
}
