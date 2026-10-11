const CAPTURE_LOCK_EVENT = 'cureocity:browser-capture-lock';
const CAPTURE_LOCK_STORAGE_KEY = 'cureocity:browser-capture-lock:nonce';
const NONCE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Stop local capture synchronously; notify other same-origin tabs without PHI. */
export function emitBrowserCaptureLock(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CAPTURE_LOCK_EVENT));
  try {
    // A fresh nonce triggers storage events even for repeated sign-out attempts.
    // No identity, token, patient/session ID or recovery key enters this signal.
    window.localStorage.setItem(CAPTURE_LOCK_STORAGE_KEY, crypto.randomUUID());
  } catch {
    // Storage may be blocked. Same-tab capture has already been stopped.
  }
}

/** Signal only: subscribers own their stop/flush lifecycle and never auto-resume. */
export function subscribeBrowserCaptureLock(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window;
  const notify = () => {
    try {
      listener();
    } catch {
      // One failing capture consumer must not prevent another from stopping.
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CAPTURE_LOCK_STORAGE_KEY || !event.newValue || !NONCE.test(event.newValue))
      return;
    try {
      if (event.storageArea !== target.localStorage) return;
    } catch {
      return;
    }
    // Do not re-emit: incoming cross-tab signals must not form a broadcast loop.
    notify();
  };
  target.addEventListener(CAPTURE_LOCK_EVENT, notify);
  target.addEventListener('storage', onStorage);
  return () => {
    target.removeEventListener(CAPTURE_LOCK_EVENT, notify);
    target.removeEventListener('storage', onStorage);
  };
}
