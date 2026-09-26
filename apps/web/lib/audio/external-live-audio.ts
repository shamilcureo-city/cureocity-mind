/** A mixer dispatches this before React renders so live capture stops at the gap. */
export const EXTERNAL_AUDIO_INTERRUPTED_EVENT = 'cureocity-external-audio-interrupted';

export function usableExternalAudio(stream: MediaStream | null | undefined): boolean {
  const tracks = stream?.getAudioTracks() ?? [];
  return (
    tracks.length > 0 &&
    tracks.every((track) => track.readyState === 'live' && track.enabled && !track.muted)
  );
}

/** Never take ownership of a call's original tracks or capture its camera track. */
export function cloneExternalAudio(stream: MediaStream): MediaStream {
  if (!usableExternalAudio(stream))
    throw new Error('Call audio is unavailable. Reconnect both sides before recording.');
  const owned: MediaStreamTrack[] = [];
  try {
    for (const track of stream.getAudioTracks()) owned.push(track.clone());
    return new MediaStream(owned);
  } catch (error) {
    owned.forEach((track) => track.stop());
    throw error;
  }
}
