export type MicrophonePermission = PermissionState | 'unsupported';
export interface CaptureMicrophone {
  deviceId: string;
  label: string;
}
export type CapturePreflightIssueCode =
  | 'CAPTURE_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_PROMPT'
  | 'MICROPHONE_MISSING'
  | 'MIC_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';
export interface CapturePreflightIssue {
  code: CapturePreflightIssueCode;
  message: string;
  action: string;
}
export interface CapturePreflightDependencies {
  isCompatible(): boolean;
  permissionState(): Promise<MicrophonePermission>;
  listMicrophones(): Promise<CaptureMicrophone[]>;
  /** Resolves only after opening a live audio track. The browser adapter must
   * stop acquired tracks on success and failure. No sound is sampled. */
  openMicrophone(deviceId: string | null): Promise<CaptureMicrophone>;
  serviceReady(): Promise<boolean>;
}
export interface CapturePreflightInput {
  selectedDeviceId?: string | null;
  /** Only an explicit user action may trigger a new browser permission prompt. */
  requestPermission?: boolean;
}
export interface CapturePreflightResult {
  ready: boolean;
  microphones: CaptureMicrophone[];
  selectedMicrophone: CaptureMicrophone | null;
  permission: MicrophonePermission;
  compatibility: boolean;
  service: boolean;
  issues: CapturePreflightIssue[];
  supportDetails: Record<string, unknown>;
}
type OpenResult =
  | { microphone: CaptureMicrophone; errorName: null }
  | { microphone: null; errorName: string };

export async function runCapturePreflight(
  input: CapturePreflightInput,
  deps: CapturePreflightDependencies,
): Promise<CapturePreflightResult> {
  const compatibility = deps.isCompatible();
  const requestedDeviceId = input.selectedDeviceId || null;
  const requestPermission = input.requestPermission === true;
  const open = async (): Promise<OpenResult> => {
    try {
      return { microphone: await deps.openMicrophone(requestedDeviceId), errorName: null };
    } catch (error) {
      return { microphone: null, errorName: safeErrorName(error) };
    }
  };
  // Start within the button's gesture, before permission/service requests yield.
  // Enumeration can be empty until the user grants access.
  const requestedOpen = compatibility && requestPermission ? open() : null;
  const errors: Record<string, string | null> = {
    permissionErrorName: null,
    enumerationErrorName: null,
    serviceErrorName: null,
  };
  const read = async <T>(operation: () => Promise<T>, fallback: T, key: string): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      errors[key] = safeErrorName(error);
      return fallback;
    }
  };
  const [queriedPermission, service] = await Promise.all([
    compatibility
      ? read<MicrophonePermission>(
          () => deps.permissionState(),
          'unsupported',
          'permissionErrorName',
        )
      : Promise.resolve<MicrophonePermission>('unsupported'),
    read(() => deps.serviceReady(), false, 'serviceErrorName'),
  ]);
  let permission = queriedPermission;
  const opened = requestedOpen
    ? await requestedOpen
    : compatibility && permission === 'granted'
      ? await open()
      : null;
  const openedMicrophone = opened?.microphone ?? null;
  if (openedMicrophone) permission = 'granted';
  if (opened?.errorName === 'NotAllowedError' || opened?.errorName === 'SecurityError') {
    permission = 'denied';
  }

  // Enumerate after access: labels may only become available then. Enumeration
  // is ancillary; its failure cannot invalidate an actually opened device.
  const microphones = compatibility
    ? [...(await read(() => deps.listMicrophones(), [], 'enumerationErrorName'))]
    : [];
  let selectedMicrophone = requestedDeviceId
    ? (microphones.find((microphone) => microphone.deviceId === requestedDeviceId) ?? null)
    : (microphones[0] ?? null);
  if (openedMicrophone) {
    selectedMicrophone =
      microphones.find((microphone) => microphone.deviceId === openedMicrophone.deviceId) ??
      openedMicrophone;
    if (!microphones.some((microphone) => microphone.deviceId === openedMicrophone.deviceId)) {
      microphones.push(openedMicrophone);
    }
  }

  const issues: CapturePreflightIssue[] = [];
  if (!compatibility) {
    issues.push({
      code: 'CAPTURE_UNSUPPORTED',
      message: 'Recording is not supported in this browser.',
      action: 'Use a current version of Chrome or Edge',
    });
  } else if (opened?.errorName) {
    issues.push(microphoneIssue(opened.errorName));
  } else if (!openedMicrophone) {
    issues.push(
      permission === 'denied'
        ? microphoneIssue('NotAllowedError')
        : {
            code: 'PERMISSION_PROMPT',
            message: 'Allow microphone access to continue.',
            action: 'Choose Allow microphone, then allow access in your browser if asked',
          },
    );
  }
  if (!service) {
    issues.push({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The live scribe is not ready right now.',
      action: 'Retry service check',
    });
  }
  return {
    ready: openedMicrophone !== null && issues.length === 0,
    microphones,
    selectedMicrophone,
    permission,
    compatibility,
    service,
    issues,
    supportDetails: {
      permission,
      compatibility,
      service,
      microphoneOpened: openedMicrophone !== null,
      permissionRequested: requestPermission,
      microphoneErrorName: opened?.errorName ?? null,
      ...errors,
    },
  };
}

function microphoneIssue(errorName: string): CapturePreflightIssue {
  if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Microphone access is blocked.',
      action: 'Allow microphone access in your browser or system settings, then try again',
    };
  }
  if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
    return {
      code: 'MICROPHONE_MISSING',
      message: 'The selected microphone is not available.',
      action: 'Connect a microphone or choose another microphone',
    };
  }
  return {
    code: 'MIC_UNAVAILABLE',
    message: 'We could not open this microphone.',
    action: 'Close other apps using it, choose another microphone, or try again',
  };
}

/** Never expose raw exception messages or arbitrary names in support details. */
function safeErrorName(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  return typeof name === 'string' &&
    [
      'NotAllowedError',
      'SecurityError',
      'NotFoundError',
      'OverconstrainedError',
      'NotReadableError',
      'AbortError',
      'InvalidStateError',
      'NotSupportedError',
      'TypeError',
      'Error',
    ].includes(name)
    ? name
    : 'UnknownError';
}
