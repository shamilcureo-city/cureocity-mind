import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MK2 — profile headshot upload. The studio crops/downscales client-side
 * (≤512px square JPEG) and sends a data URL; bytes are stored inline
 * (postgres bytea, same doctrine as audio chunks — no object-storage
 * dependency) and served anonymously by the public photo route.
 */

const MAX_BYTES = 700 * 1024; // generous for a 512px JPEG

const UploadPhotoSchema = z.object({
  dataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'must be an image data URL')
    .max(Math.ceil((MAX_BYTES * 4) / 3) + 64),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, UploadPhotoSchema);
  if (!body.ok) return body.response;

  const [meta, base64] = body.value.dataUrl.split(',', 2);
  const mimeType = meta!.slice('data:'.length, meta!.indexOf(';'));
  const bytes = Buffer.from(base64!, 'base64');
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large — crop to 512px.' }, { status: 413 });
  }

  await prisma.psychologistPhoto.upsert({
    where: { psychologistId: auth.value.psychologistId },
    create: { psychologistId: auth.value.psychologistId, bytes, mimeType },
    update: { bytes, mimeType },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PSYCHOLOGIST_UPDATED',
    targetType: 'Psychologist',
    targetId: auth.value.psychologistId,
    metadata: { fields: ['photo'], bytes: bytes.byteLength },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  await prisma.psychologistPhoto.deleteMany({
    where: { psychologistId: auth.value.psychologistId },
  });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PSYCHOLOGIST_UPDATED',
    targetType: 'Psychologist',
    targetId: auth.value.psychologistId,
    metadata: { fields: ['photo'], removed: true },
  });
  return NextResponse.json({ ok: true });
}
