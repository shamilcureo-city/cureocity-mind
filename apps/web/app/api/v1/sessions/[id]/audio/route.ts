import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sessions/[id]/audio.wav — debug-only: rebuilds the
 * exact WAV bytes that the orchestrator sends to Vertex Pass 1, so
 * you can download and listen to verify the recording captured
 * actual signal (vs silence / low gain / muted mic / endianness bug).
 *
 * Sample rate / channels / bit depth are hard-coded to 16 kHz mono
 * 16-bit because that's what the AudioWorklet decimator produces.
 * If you ever support a different capture pipeline, surface those
 * params on AudioChunk and read them here.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const chunks = await prisma.audioChunk.findMany({
    where: { sessionId },
    orderBy: { chunkIndex: 'asc' },
    select: { bytes: true },
  });
  const pcm = Buffer.concat(chunks.map((c) => (c.bytes ? Buffer.from(c.bytes) : Buffer.alloc(0))));
  if (pcm.byteLength === 0) {
    return NextResponse.json({ error: 'No audio bytes for this session' }, { status: 404 });
  }

  // Amplitude stats on the raw PCM — if max abs sample is near 0,
  // the recording captured silence. 16-bit samples range ±32767;
  // typical speech RMS is in the thousands.
  const stats = pcmStats(pcm);

  const wav = wrapPcmInWav(pcm, 16000, 1, 16);

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="session-${sessionId.slice(0, 8)}.wav"`,
      'Content-Length': String(wav.byteLength),
      'X-Pcm-Bytes': String(pcm.byteLength),
      'X-Pcm-Samples': String(pcm.byteLength / 2),
      'X-Pcm-RMS': String(Math.round(stats.rms)),
      'X-Pcm-Max-Abs': String(stats.maxAbs),
      'X-Pcm-Pct-Silent': stats.percentSilent.toFixed(2),
      'Cache-Control': 'private, no-store',
    },
  });
}

function pcmStats(pcm: Buffer): { rms: number; maxAbs: number; percentSilent: number } {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = pcm.byteLength / 2;
  let sumSquares = 0;
  let maxAbs = 0;
  let silentSamples = 0;
  for (let i = 0; i < sampleCount; i++) {
    const s = view.getInt16(i * 2, true);
    const abs = Math.abs(s);
    sumSquares += s * s;
    if (abs > maxAbs) maxAbs = abs;
    if (abs < 100) silentSamples++; // ≈ -50 dBFS noise floor
  }
  return {
    rms: Math.sqrt(sumSquares / sampleCount),
    maxAbs,
    percentSilent: (silentSamples / sampleCount) * 100,
  };
}

function wrapPcmInWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
