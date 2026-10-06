'use client';

import { useEffect, useRef, useState } from 'react';
import {
  checkMicrophone,
  MicrophoneCheckError,
  type MicrophoneCheckProgress,
  type MicrophoneCheckResult,
} from '@/lib/audio/microphone-check';
import { Button } from '../ui/Button';
import styles from './ScribeMicrophoneDialog.module.css';

type Device = { deviceId: string; label: string };
type Permission = PermissionState | 'unknown' | 'unsupported';

/** Injectable only for the development preview and deterministic tests. */
export interface ScribeMicrophoneEnvironment {
  permission(): Promise<PermissionStatus | null>;
  devices(): Promise<Device[]>;
  subscribeDevices(listener: () => void): () => void;
  check: typeof checkMicrophone;
}

const browserEnvironment: ScribeMicrophoneEnvironment = {
  async permission() {
    try {
      return await navigator.permissions.query({ name: 'microphone' as PermissionName });
    } catch {
      return null;
    }
  },
  async devices() {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    return (devices ?? [])
      .filter((device) => device.kind === 'audioinput' && device.deviceId)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
  },
  subscribeDevices(listener) {
    navigator.mediaDevices?.addEventListener('devicechange', listener);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', listener);
  },
  check: checkMicrophone,
};

const ERRORS: Record<MicrophoneCheckError['code'], { title: string; detail: string }> = {
  'permission-denied': {
    title: 'Microphone access is blocked',
    detail:
      'Allow microphone access for this site in your browser and system settings, then retry.',
  },
  missing: {
    title: 'This microphone is not available',
    detail: 'Connect your microphone or choose another one, then retry the test.',
  },
  unavailable: {
    title: 'The microphone could not start',
    detail:
      'Check your system input device. If another call or app is using it, finish that first, then retry.',
  },
  ended: {
    title: 'The microphone stopped during the check',
    detail:
      'Consultation recording is off; previously captured words are unchanged. Check your system input device, choose another microphone, or restart your browser after saving your work.',
  },
  muted: {
    title: 'The microphone is not sending audio',
    detail: 'Check the device mute control and system input settings, then retry.',
  },
  'no-frames': {
    title: 'The audio check could not complete',
    detail:
      'The microphone opened, but audio frames did not arrive. Retry or choose another microphone. This is not caused by speaking too quietly.',
  },
  timeout: {
    title: 'The microphone check timed out',
    detail:
      'If a permission request is waiting beside the address bar, allow access and retry. If access is already allowed, check your system input device or try another microphone.',
  },
  unsupported: {
    title: 'Microphone testing is unavailable',
    detail: 'Open Scribe in a current browser using its secure https address, then try again.',
  },
  cancelled: {
    title: 'Microphone check stopped',
    detail: 'Nothing was recorded or uploaded. Test the microphone again when you are ready.',
  },
};

/** No microphone, session request or gateway connection is opened on mount.
 * The short test is local-only; clinical Start still performs server consent
 * and access checks and reacquires the selected device. */
export function ScribeMicrophoneDialog({
  onCancel,
  onContinue,
  action = 'start',
  environment = browserEnvironment,
}: {
  onCancel: () => void;
  onContinue: (deviceId: string) => void;
  action?: 'start' | 'resume';
  environment?: ScribeMicrophoneEnvironment;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const continued = useRef(false);
  const [permission, setPermission] = useState<Permission>('unknown');
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [progress, setProgress] = useState<MicrophoneCheckProgress | null>(null);
  const [result, setResult] = useState<MicrophoneCheckResult | null>(null);
  const [issue, setIssue] = useState<(typeof ERRORS)[keyof typeof ERRORS] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validResult = useRef<MicrophoneCheckResult | null>(null);

  function invalidate(message?: string) {
    ++generation.current;
    request.current?.abort();
    request.current = null;
    validResult.current = null;
    if (!mounted.current) return;
    setProgress(null);
    setResult(null);
    setIssue(null);
    setNotice(message ?? null);
  }

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    dialog?.showModal();
    let disposed = false;
    let permissionStatus: PermissionStatus | null = null;
    const permissionChanged = () => {
      if (disposed || !mounted.current || !permissionStatus) return;
      setPermission(permissionStatus.state);
      // Allowing the browser prompt is the expected next step of this test.
      if (permissionStatus.state === 'granted' && request.current) return;
      invalidate('Microphone permission changed. Test again before continuing.');
    };
    void environment
      .permission()
      .then((status) => {
        if (disposed || !mounted.current) return;
        permissionStatus = status;
        setPermission(status?.state ?? 'unsupported');
        status?.addEventListener('change', permissionChanged);
      })
      .catch(() => {
        if (!disposed && mounted.current) setPermission('unsupported');
      });
    const refreshDevices = () => {
      void environment
        .devices()
        .then((list) => {
          if (!disposed && mounted.current) setDevices(list);
        })
        .catch(() => {});
    };
    refreshDevices();
    const unsubscribeDevices = environment.subscribeDevices(() => {
      // Granting permission can reveal devices and dispatch devicechange. The
      // active test watches its actual track; don't cancel that permission flow.
      if (!request.current)
        invalidate('The available microphones changed. Choose a microphone and test again.');
      refreshDevices();
    });
    const hidden = () => {
      if (document.visibilityState === 'hidden')
        invalidate('Microphone check stopped while this page was away. Test again to continue.');
    };
    const pageHide = () => invalidate();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pageHide);
    return () => {
      disposed = true;
      mounted.current = false;
      invalidate();
      permissionStatus?.removeEventListener('change', permissionChanged);
      unsubscribeDevices();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pageHide);
      dialog?.close();
    };
  }, [environment]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(
      () => invalidate('Run a fresh microphone check before continuing.'),
      30_000,
    );
    return () => clearTimeout(timer);
  }, [result]);

  function testMicrophone() {
    if (request.current || continued.current) return;
    invalidate();
    const attempt = generation.current;
    const controller = new AbortController();
    request.current = controller;
    setProgress({ stage: 'requesting', level: 0, frames: 0, device: null });
    const current = () =>
      mounted.current && generation.current === attempt && !controller.signal.aborted;
    // Call synchronously in the button gesture, not after a permissions query.
    void environment
      .check({
        deviceId: selectedDeviceId || undefined,
        signal: controller.signal,
        onProgress: (value) => {
          if (current()) setProgress(value);
        },
      })
      .then((checked) => {
        if (!current()) return;
        request.current = null;
        validResult.current = checked;
        setProgress(null);
        setResult(checked);
        setPermission('granted');
        setSelectedDeviceId(checked.deviceId);
        void environment
          .devices()
          .then((list) => {
            if (current())
              setDevices(
                list.some((d) => d.deviceId === checked.deviceId) ? list : [...list, checked],
              );
          })
          .catch(() => {
            if (current()) setDevices([checked]);
          });
      })
      .catch((error: unknown) => {
        if (!current()) return;
        request.current = null;
        setProgress(null);
        const code = error instanceof MicrophoneCheckError ? error.code : 'unavailable';
        setIssue(ERRORS[code]);
        if (code === 'permission-denied') setPermission('denied');
      });
  }

  function cancel() {
    invalidate();
    onCancel();
  }

  function proceed() {
    const checked = validResult.current;
    if (!checked || request.current || continued.current || permission === 'denied') return;
    continued.current = true;
    invalidate();
    onContinue(checked.deviceId);
  }

  const blocked = permission === 'denied';
  const title =
    issue?.title ??
    (result
      ? 'Microphone check passed'
      : progress
        ? progress.stage === 'requesting'
          ? 'Waiting for microphone access'
          : 'Checking your microphone'
        : blocked
          ? 'Microphone access is blocked'
          : permission === 'granted'
            ? 'Access allowed. Test your microphone.'
            : 'Enable your microphone');
  const detail =
    issue?.detail ??
    (result
      ? result.heardSound
        ? `${result.label} received audio. The test is complete and the microphone is off.`
        : `${result.label} is sending audio frames. No sound was detected; silence does not mean the microphone is broken. The microphone is now off.`
      : progress?.stage === 'requesting'
        ? 'Choose Allow in your browser if asked. If access was already allowed, no new permission popup is needed.'
        : progress
          ? 'Speak a few words if you like. This short check stops automatically; silence is OK.'
          : blocked
            ? ERRORS['permission-denied'].detail
            : permission === 'granted'
              ? 'Your browser already allows microphone access, so it may not show another popup. Test whether the microphone is sending audio.'
              : 'Run a short microphone test before live transcription. Opening this dialog does not turn on the microphone.');
  const level = Math.min(100, Math.round(Math.sqrt(Math.max(0, progress?.level ?? 0)) * 100));

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="scribe-microphone-title"
      aria-describedby="scribe-microphone-description"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className={styles.header}>
        <h2 id="scribe-microphone-title">Ready to {action === 'resume' ? 'resume' : 'consult'}?</h2>
        <button
          type="button"
          onClick={cancel}
          className={styles.close}
          aria-label="Close microphone check"
        >
          ×
        </button>
      </div>
      <p id="scribe-microphone-description" className={styles.intro}>
        Check your microphone before {action === 'resume' ? 'resuming' : 'starting'} live
        transcription. Test audio stays on this device. Nothing is saved or uploaded.
      </p>
      <div className={styles.device}>
        <label htmlFor="scribe-microphone-device">Microphone</label>
        <select
          id="scribe-microphone-device"
          value={selectedDeviceId}
          disabled={!!progress}
          onChange={(event) => {
            invalidate();
            setSelectedDeviceId(event.target.value);
          }}
        >
          <option value="">System default microphone</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </div>
      <section
        className={styles.check}
        data-state={issue || blocked ? 'error' : result ? 'ready' : 'idle'}
      >
        <div role={issue || blocked ? 'alert' : 'status'} aria-live="polite">
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
        {progress?.stage === 'checking' && (
          <div className={styles.meterRow}>
            <meter min={0} max={100} value={level} aria-label="Local microphone input level" />
            <span>{level > 0 ? 'Input detected' : 'Listening for sound'}</span>
          </div>
        )}
        {progress ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => invalidate('Microphone test stopped. Nothing was recorded or uploaded.')}
          >
            Stop microphone test
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={testMicrophone}>
            {issue || blocked
              ? 'Retry microphone test'
              : result
                ? 'Test again'
                : permission === 'granted'
                  ? 'Test microphone'
                  : 'Enable microphone & test'}
          </Button>
        )}
      </section>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <details className={styles.help} open={blocked || !!issue}>
        <summary>Microphone help</summary>
        <ol>
          <li>
            In Chrome, click the controls icon beside the address, open Site settings, and allow
            Microphone for this site. Reload if Chrome asks.
          </li>
          <li>
            On a Mac, check System Settings → Privacy &amp; Security → Microphone → Google Chrome.
            In Sound → Input, select the microphone you want to use.
          </li>
          <li>
            If access is already allowed but the test fails, try another microphone or restart
            Chrome after saving your work.
          </li>
        </ol>
      </details>
      <p className={styles.boundary}>
        Microphone permission does not replace patient consent. Starting will recheck this
        consultation’s consent and access.
      </p>
      <div className={styles.footer}>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button type="button" onClick={proceed} disabled={!result || !!progress || blocked}>
          {action === 'resume' ? 'Resume recording' : 'Start consultation'}
        </Button>
      </div>
    </dialog>
  );
}
