import type { CaptureMicrophone } from '../capture-preflight';

/** Check access, not loudness. No analyser, recording, or audio upload: the
 * temporary stream is released even if inspecting the device fails. */
export async function openCaptureMicrophone(
  deviceId: string | null,
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
  isCurrent: () => boolean = () => true,
): Promise<CaptureMicrophone> {
  let stream: MediaStream | undefined;
  try {
    if (!isCurrent()) throw new DOMException('Check no longer active', 'AbortError');
    stream = await mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    // getUserMedia cannot cancel an outstanding browser prompt. If the user
    // left or withdrew consent meanwhile, release a late-granted stream.
    if (!isCurrent()) throw new DOMException('Check no longer active', 'AbortError');
    const track = stream.getAudioTracks().find((candidate) => candidate.readyState === 'live');
    if (!track) throw new DOMException('No available audio track', 'NotReadableError');
    return {
      deviceId: deviceId || track.getSettings().deviceId || '',
      label: track.label || 'Microphone',
    };
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}
