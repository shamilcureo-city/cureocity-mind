'use client';

import { useEffect, useState } from 'react';

/**
 * PwaInstallPrompt — surfaces the Add-to-Home-Screen affordance.
 *
 * Two paths:
 *   - Chromium-based browsers (Android, desktop): listens for
 *     `beforeinstallprompt`, hooks the install button to it.
 *   - iOS Safari: no event; shows guidance text directing the user to
 *     the Share menu → "Add to Home Screen". Detected via UA + lack of
 *     standalone display mode.
 *
 * Self-dismisses when the app is already running standalone
 * (display-mode: standalone OR navigator.standalone on iOS) so an
 * installed PWA never shows the prompt.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosGuide, setIosGuide] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isRunningStandalone()) {
      setHidden(true);
      return;
    }
    const handler = (e: Event): void => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    if (isIosSafari()) setIosGuide(true);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (hidden) return null;
  if (!evt && !iosGuide) return null;

  async function install(): Promise<void> {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === 'accepted') setHidden(true);
    setEvt(null);
  }

  return (
    <aside className="mb-6 rounded-2xl border border-[var(--color-warm-500)] bg-[var(--color-warm-50)] p-4">
      <p className="text-sm font-medium text-[var(--color-navy-700)]">
        Add Cureocity Mind to your home screen
      </p>
      <p className="mt-1 text-xs text-[var(--color-slate-500)]">
        {iosGuide
          ? 'Tap the Share icon below, then "Add to Home Screen". You\'ll get push reminders for your exercises.'
          : 'Install for one-tap access and push reminders.'}
      </p>
      <div className="mt-3 flex gap-2">
        {evt && (
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-[var(--color-navy-700)] px-3 py-1.5 text-xs font-medium text-white"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="rounded-md border border-[var(--color-slate-200)] bg-white px-3 py-1.5 text-xs"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}

function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  if (mql?.matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
  return iOS && webkit;
}
