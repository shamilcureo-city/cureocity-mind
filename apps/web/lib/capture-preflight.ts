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
  | 'NO_INPUT'
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
  sampleInputLevel(deviceId: string): Promise<number>;
  serviceReady(): Promise<boolean>;
}

export async function runCapturePreflight(
  input: { selectedDeviceId?: string | null },
  deps: CapturePreflightDependencies,
): Promise<{
  ready: boolean;
  selectedMicrophone: CaptureMicrophone | null;
  permission: MicrophonePermission;
  inputLevel: number;
  compatibility: boolean;
  service: boolean;
  issues: CapturePreflightIssue[];
  supportDetails: Record<string, unknown>;
}> {
  const compatibility = deps.isCompatible();
  const [permission, microphones, service] = await Promise.all([
    deps.permissionState(),
    deps.listMicrophones(),
    deps.serviceReady(),
  ]);
  const selectedMicrophone = input.selectedDeviceId
    ? (microphones.find((m) => m.deviceId === input.selectedDeviceId) ?? null)
    : (microphones[0] ?? null);
  const inputLevel = selectedMicrophone
    ? await deps.sampleInputLevel(selectedMicrophone.deviceId).catch(() => 0)
    : 0;
  const issues: CapturePreflightIssue[] = [];
  if (!compatibility) {
    issues.push({
      code: 'CAPTURE_UNSUPPORTED',
      message: 'Live recording is not supported in this browser.',
      action: 'Use a current version of Chrome or Edge',
    });
  }
  if (permission === 'denied') {
    issues.push({
      code: 'PERMISSION_DENIED',
      message: 'Allow microphone access in your browser, then try again.',
      action: 'Open browser microphone settings',
    });
  } else if (permission === 'prompt') {
    issues.push({
      code: 'PERMISSION_PROMPT',
      message: 'Your browser still needs microphone permission.',
      action: 'Allow microphone access',
    });
  }
  if (!selectedMicrophone) {
    issues.push({
      code: 'MICROPHONE_MISSING',
      message: 'The selected microphone is not available.',
      action: 'Choose another microphone',
    });
  } else if (permission === 'granted' && inputLevel <= 0.01) {
    issues.push({
      code: 'NO_INPUT',
      message: 'We cannot hear input from this microphone.',
      action: 'Speak, check mute, or choose another microphone',
    });
  }
  if (!service) {
    issues.push({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The live scribe is not ready right now.',
      action: 'Retry service check',
    });
  }
  return {
    ready: issues.length === 0,
    selectedMicrophone,
    permission,
    inputLevel,
    compatibility,
    service,
    issues,
    supportDetails: {
      selectedDeviceId: input.selectedDeviceId ?? null,
      availableDeviceIds: microphones.map((m) => m.deviceId),
      permission,
      inputLevel,
      compatibility,
      service,
    },
  };
}
