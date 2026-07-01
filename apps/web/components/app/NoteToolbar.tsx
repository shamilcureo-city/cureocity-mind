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

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2';

const ICON_BTN = `grid h-9 w-9 place-items-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)] ${FOCUS_RING}`;

// A non-interactive status chip (lock/unlock). Same footprint as ICON_BTN but
// without hover/focus affordances — it reports state, it isn't a control.
const STATUS_CHIP =
  'grid h-9 w-9 place-items-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-2)]';

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
    const ok = await copyText(noteText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
          className={`${ICON_BTN} ${copied ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : ''}`}
          title={copied ? 'Copied!' : 'Copy note'}
          aria-label={copied ? 'Copied' : 'Copy note'}
        >
          <Icon kind={copied ? 'check' : 'copy'} />
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
          role="status"
          className={STATUS_CHIP}
          title={signed ? 'Signed — locked' : 'Draft — still editable'}
          aria-label={signed ? 'Signed — locked' : 'Draft — still editable'}
        >
          <Icon kind={signed ? 'lock' : 'unlock'} />
        </span>

        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className={`grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)] ${FOCUS_RING}`}
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

/**
 * Copy text to the clipboard, falling back to a hidden-textarea + execCommand
 * when the async Clipboard API is unavailable or blocked (older WebViews,
 * non-secure contexts). Returns whether the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function Icon({
  kind,
}: {
  kind: 'review' | 'copy' | 'check' | 'download' | 'share' | 'lock' | 'unlock';
}) {
  const paths: Record<typeof kind, string> = {
    review: 'M3 12h4l2 6 4-12 2 6h6',
    copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    check: 'M5 13l4 4L19 7',
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
