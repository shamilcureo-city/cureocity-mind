/**
 * Float32 [-1, 1] → Int16 [-32768, 32767] PCM.
 * Returns a fresh Uint8Array of bytes in little-endian order.
 */
export function float32ToInt16Le(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i]!;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    // Round to nearest int; clip the +1 case to avoid 32768 overflow.
    const intVal = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    view.setInt16(i * 2, intVal, true);
  }
  return bytes;
}

/**
 * Inverse — useful for round-trip tests.
 */
export function int16LeToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.length % 2 !== 0) throw new Error('Byte length must be even for Int16 LE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) {
    const intVal = view.getInt16(i * 2, true);
    out[i] = intVal < 0 ? intVal / 32768 : intVal / 32767;
  }
  return out;
}
