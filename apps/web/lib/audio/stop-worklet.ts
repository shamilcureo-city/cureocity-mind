/** Port ordering guarantees all captured frames arrive before this acknowledgement. */
export function stopWorklet(node: AudioWorkletNode | null): Promise<void> {
  if (!node) return Promise.resolve();
  const port = node.port;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.removeEventListener('message', onMessage);
      reject(
        new Error('Capture could not confirm its final audio frame. Keep this tab open and retry.'),
      );
    }, 2000);
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== 'stopped') return;
      clearTimeout(timeout);
      port.removeEventListener('message', onMessage);
      resolve();
    }
    port.addEventListener('message', onMessage);
    port.postMessage({ type: 'stop' });
  });
}
