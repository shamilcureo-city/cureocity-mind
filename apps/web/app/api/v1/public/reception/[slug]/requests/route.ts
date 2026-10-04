import type { NextRequest } from 'next/server';
import { ReceptionRequestInputSchema } from '@/lib/reception';
import { consumeReceptionRateLimit, submitReceptionRequest } from '@/lib/reception-store';
import {
  ReceptionError,
  readReceptionInput,
  receptionFailure,
  receptionJson,
  requirePublicReceptionOrigin,
  requireReceptionPilot,
} from '@/lib/reception-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireReceptionPilot();
    requirePublicReceptionOrigin(req);
    const { slug } = await params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 64)
      throw new ReceptionError(404, 'Reception is not available.');
    await consumeReceptionRateLimit(slug, req);
    const input = await readReceptionInput(req, ReceptionRequestInputSchema);
    return receptionJson(await submitReceptionRequest(slug, input), 201);
  } catch (error) {
    return receptionFailure(error);
  }
}
