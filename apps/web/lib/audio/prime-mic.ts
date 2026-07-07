/**
 * Sprint DS11.3 — prime the microphone permission on the SAME user gesture
 * that starts a consult, so the live page's auto-start works from patient
 * #1 (browsers only honour getUserMedia after a gesture until permission
 * sticks; patients 2..N were already zero-tap).
 *
 * Await this BEFORE navigating: navigating while the permission prompt is
 * open dismisses it. Resolves quickly when permission is already granted;
 * a denial resolves too (the live page's StartPanel is the fallback).
 */
export async function primeMicPermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    /* denied / unavailable — the live page surfaces its own fallback */
  }
}
