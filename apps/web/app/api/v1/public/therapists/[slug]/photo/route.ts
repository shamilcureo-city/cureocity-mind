import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MK2 — PUBLIC (no auth) headshot for a PUBLISHED profile. Resolves by
 * slug so nothing internal leaks; unpublished profiles 404 exactly like
 * their pages do. Long cache with the ?v= stamp busting on re-upload.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const therapist = await prisma.psychologist.findFirst({
    where: {
      publicSlug: slug,
      deletedAt: null,
      vertical: 'THERAPIST',
      profilePublishedAt: { not: null },
    },
    select: { id: true },
  });
  if (!therapist) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const photo = await prisma.psychologistPhoto.findUnique({
    where: { psychologistId: therapist.id },
  });
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.mimeType,
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
