import { NextResponse, type NextRequest } from 'next/server';
import { fetchPublicTherapists } from '@/lib/directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const filters = {
    specialty: params.get('specialty') ?? undefined,
    language: params.get('language') ?? undefined,
    modality: params.get('modality') ?? undefined,
    city: params.get('city') ?? undefined,
    acceptingOnly: params.get('accepting') === '1',
  };
  const limit = Math.min(Math.max(Number(params.get('limit') ?? '50'), 1), 100);
  const rows = await fetchPublicTherapists(filters, limit);
  return NextResponse.json({ therapists: rows, count: rows.length });
}
