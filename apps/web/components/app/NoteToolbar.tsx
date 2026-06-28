'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';

/**
 * Sprint 70 (redesign) — the clean note toolbar matching the reference: the
 * `BASE ▾` / `Detailed ▾` controls (passed in as `leftControls`) on the left,
 * an icon-only action cluster on the right, and a small client avatar at the
 * far right. No text labels; tooltips carry the meaning.
 */

interface Props {
  sessionId: string;
  clientName: string;
  /** Plain-text rendering of the note, for the Copy action. */
  noteText: string;
  signed: boolean;
  /** Opens the Share flow. When present on an unsigned note the handler
   *  signs first, then shares (so the report is finalised before it goes out). */
  onShare?: () => void;
  /** The BASE (template) + language + Detailed controls, rendered on the left.
   *  The note language now lives in that language control, not a flag here. */
  leftControls?: ReactNode;
}

const ICON_BTN =
  'grid h-9 w-9 place-items-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)]';

export function NoteToolbar({
  sessionId,
  clientName,
  noteText,
  signed,
  onShare,
  leftControls,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(noteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">{leftControls}</div>

      <div className="flex items-center gap-1.5">
        <Link
          href={`/app/sessions/${sessionId}?tab=copilot`}
          className={ICON_BTN}
          title="Review diagnosis"
          aria-label="Review diagnosis"
        >
          <Icon kind="review" />
        </Link>

        <button
          type="button"
          onClick={copy}
          className={`${ICON_BTN} ${copied ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : ''}`}
          title={copied ? 'Copied' : 'Copy note'}
          aria-label="Copy note"
        >
          <Icon kind="copy" />
        </button>

        {signed && (
          <a
            href={`/api/v1/sessions/${sessionId}/note/pdf`}
            download
            className={ICON_BTN}
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Icon kind="download" />
          </a>
        )}

        <span
          className={`${ICON_BTN} cursor-default`}
          title={signed ? 'Signed — locked' : 'Draft — still editable'}
        >
          <Icon kind={signed ? 'lock' : 'unlock'} />
        </span>

        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            title={signed ? 'Share with patient' : 'Sign & share with patient'}
            aria-label={signed ? 'Share with patient' : 'Sign and share with patient'}
          >
            <Icon kind="share" />
          </button>
        )}

        <span
          aria-hidden
          title={clientName}
          className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]"
        >
          {initials(clientName)}
        </span>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function Icon({ kind }: { kind: 'review' | 'copy' | 'download' | 'share' | 'lock' | 'unlock' }) {
  const paths: Record<typeof kind, string> = {
    review: 'M3 12h4l2 6 4-12 2 6h6',
    copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    download: 'M12 3v12M8 11l4 4 4-4M5 21h14',
    share: 'M12 16V4M8 8l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
    lock: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v9H5z',
    unlock: 'M7 11V8a5 5 0 0 1 9.9-1M5 11h14v9H5z',
  };
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
