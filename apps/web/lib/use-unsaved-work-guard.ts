'use client';

import { useEffect } from 'react';

/** No browser storage: protect explicit unsaved work, not a claim of crash recovery.
 * Navigation API also covers same-document Back/Forward where supported. The
 * fallback covers links and document unload; never rewrites Next's history. */
export function useUnsavedWorkGuard(active: boolean, message: string, busy = false) {
  useEffect(() => {
    if (!active && !busy) return;
    let approved = false;
    let reset: ReturnType<typeof setTimeout> | undefined;
    const allow = () => {
      if (approved) return true;
      if (busy || !window.confirm(message)) return false;
      approved = true;
      reset = setTimeout(() => {
        approved = false;
      }, 1_000);
      return true;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (approved) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const next = event as Event & {
        canIntercept?: boolean;
        hashChange?: boolean;
        downloadRequest?: string | null;
        destination?: { url: string };
      };
      if (!next.cancelable || !next.canIntercept || next.hashChange || next.downloadRequest) return;
      if (!allow()) next.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = new URL(anchor.href, location.href);
      if (target.pathname === location.pathname && target.search === location.search) return;
      if (!allow()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    navigation?.addEventListener('navigate', navigate);
    // Capture clicks as well: Next can intercept a link before a browser navigation event.
    document.addEventListener('click', click, true);
    return () => {
      clearTimeout(reset);
      window.removeEventListener('beforeunload', unload);
      navigation?.removeEventListener('navigate', navigate);
      document.removeEventListener('click', click, true);
    };
  }, [active, message, busy]);
}
