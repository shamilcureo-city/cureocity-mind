import type { NextRequest } from 'next/server';
import { loadPublicReception } from '@/lib/reception-store';
import {
  ReceptionError,
  receptionFailure,
  receptionJson,
  requireReceptionPilot,
} from '@/lib/reception-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireReceptionPilot();
    const { slug } = await params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 64)
      throw new ReceptionError(404, 'Reception is not available.');
    return receptionJson(await loadPublicReception(slug));
  } catch (error) {
    return receptionFailure(error);
  }
}
