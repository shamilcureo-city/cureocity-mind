'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Sprint 70 — the note action toolbar (the icon row above the note, matching
 * the reference template). Consolidates the actions that used to sit as
 * scattered buttons below the note: a "Review diagnosis" shortcut to the AI
 * Copilot, Copy, Download PDF, a language indicator, a signed/draft lock
 * indicator, and Share. Read-only affordances (language, lock) are indicators
 * only — switching language and the post-sign revise flow live elsewhere.
 */

const LANG: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇬🇧', label: 'English' },
  hi: { flag: '🇮🇳', label: 'Hindi' },
  ml: { flag: '🇮🇳', label: 'Malayalam' },
  ta: { flag: '🇮🇳', label: 'Tamil' },
  bn: { flag: '🇮🇳', label: 'Bengali' },
};

interface Props {
  sessionId: string;
  clientName: string;
  noteLanguage: string;
  /** Plain-text rendering of the note, for the Copy action. */
  noteText: string;
  signed: boolean;
  /** Opens the Share modal — only wired (and shown) for signed notes. */
  onShare?: () => void;
}

const ICON_BTN =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)]';

export function NoteToolbar({
  sessionId,
  clientName,
  noteLanguage,
  noteText,
  signed,
  onShare,
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

  const lang = LANG[noteLanguage] ?? { flag: '🌐', label: noteLanguage };

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-soft)] pb-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]"
        >
          {initials(clientName)}
        </span>
        <span className="text-sm font-medium text-[var(--color-ink)]">{clientName}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={`/app/sessions/${sessionId}?tab=copilot`} className={ICON_BTN}>
          <Icon kind="review" />
          <span className="hidden sm:inline">Review diagnosis</span>
        </Link>

        <button type="button" onClick={copy} className={ICON_BTN} aria-label="Copy note text">
          <Icon kind="copy" />
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>

        {signed && (
          <a
            href={`/api/v1/sessions/${sessionId}/note/pdf`}
            download
            className={ICON_BTN}
            aria-label="Download PDF"
          >
            <Icon kind="download" />
            <span className="hidden sm:inline">PDF</span>
          </a>
        )}

        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-3)]"
          title={`Note language: ${lang.label}`}
        >
          <span aria-hidden>{lang.flag}</span>
        </span>

        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-3)]"
          title={signed ? 'Signed — locked' : 'Draft — still editable'}
        >
          <Icon kind={signed ? 'lock' : 'unlock'} />
        </span>

        {signed && onShare && (
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            <Icon kind="share" />
            Share
          </button>
        )}
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
