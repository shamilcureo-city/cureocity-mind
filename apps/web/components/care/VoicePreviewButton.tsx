'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CG5 — hear-her-first voice previews (docs/CARE_GROWTH_SYSTEM.md §4).
 * Plays a pre-generated, same-origin sample (the /care CSP forbids external
 * media): /care/voice-previews/{persona}-{lang}.mp3. The component probes
 * the asset and renders NOTHING when it's missing — so shipping the en/hi
 * recordings (an ops task with native-speaker listening QA for ml/ta/bn)
 * lights the buttons up without a code change. Always labelled as an AI
 * sample — the disclosure is the hook, never fine print.
 */
export function VoicePreviewButton({ persona, lang }: { persona: string; lang: string }) {
  const src = `/care/voice-previews/${persona.toLowerCase()}-${lang}.mp3`;
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(src, { method: 'HEAD' })
      .then((r) => {
        if (!cancelled) setAvailable(r.ok);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [src]);

  if (!available) return null;

  function toggle(e: React.MouseEvent): void {
    e.stopPropagation();
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      void audioRef.current.play().then(() => setPlaying(true));
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') toggle(e as unknown as React.MouseEvent);
      }}
      className="mt-1 inline-block cursor-pointer rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-[var(--color-ink-2)]"
      aria-label={`Play a sample of ${persona}'s voice (AI sample)`}
    >
      {playing ? '■ stop' : '▶ hear her'} · AI sample
    </span>
  );
}
