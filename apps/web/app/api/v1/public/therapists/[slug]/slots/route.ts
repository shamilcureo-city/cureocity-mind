import { NextResponse, type NextRequest } from 'next/server';
import type { PublicSlotsResponse } from '@cureocity/contracts';
import { computeSlots, SLOT_WINDOW_DAYS } from '@/lib/marketing';
import { loadBusyIntervals, loadPublishedTherapist, loadWeeklyRules } from '@/lib/public-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/public/therapists/[slug]/slots
 *
 * PUBLIC (no auth) — the bookable-slot feed for a published profile's
 * appointment widget. Serves only slot instants; nothing about the
 * therapist's calendar contents leaks (a busy slot is simply absent).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const therapist = await loadPublishedTherapist(slug);
  if (!therapist) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rules = await loadWeeklyRules(therapist.id);
  const now = new Date();
  const to = new Date(now.getTime() + SLOT_WINDOW_DAYS * 24 * 60 * 60_000);
  const busy = rules.length > 0 ? await loadBusyIntervals(therapist.id, now, to) : [];

  const body: PublicSlotsResponse = {
    slots: computeSlots(rules, busy, now),
    hasAvailability: rules.length > 0,
  };
  return NextResponse.json(body);
}
