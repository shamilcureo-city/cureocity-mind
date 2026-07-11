'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * NEXT7 — shared dialog accessibility. The app's modals set
 * `role="dialog" aria-modal` but none trapped focus or restored it, so a
 * keyboard / screen-reader user could Tab straight out of an open modal
 * into the page underneath (and lose their place entirely on close).
 *
 * While `open`:
 *  - focus moves into the container (the first focusable, or the container),
 *  - Tab / Shift+Tab cycle inside the container,
 *  - Escape calls `onClose` (pass undefined to opt out, e.g. a mid-submit
 *    modal that must not close),
 * and on close, focus returns to whatever had it before the modal opened.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useModalA11y(open, ref, () => setOpen(false));
 *   ... <div ref={ref} role="dialog" aria-modal="true">
 */
export function useModalA11y(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  const restoreRef = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-running the effect per render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus in (unless something inside is already focused, e.g. an
    // autoFocus input won the race).
    if (!container.contains(document.activeElement)) {
      const first = focusables()[0];
      if (first) first.focus();
      else {
        container.tabIndex = -1;
        container.focus();
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreRef.current?.focus?.();
      restoreRef.current = null;
    };
  }, [open, containerRef]);
}
