import { NextResponse, type NextRequest } from 'next/server';
import { fetchPublicTherapistById } from '@/lib/directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { id } = await ctx.params;
  const row = await fetchPublicTherapistById(id);
  if (!row) return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
  return NextResponse.json(row);
}
