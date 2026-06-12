import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { createDemoClient, findDemoClient, removeDemoClient } from '@/lib/demo-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sprint 48 — Demo showcase client.
 *
 * POST   /api/v1/onboarding/demo-client — seed the example client.
 *        Idempotent: a second call returns the existing demo row
 *        unchanged (and 200 instead of 201).
 *
 * DELETE /api/v1/onboarding/demo-client — hard-delete the example
 *        client and every fabricated row in FK-safe order.
 *
 * GET    /api/v1/onboarding/demo-client — convenience for the UI:
 *        returns { clientId: string | null } so a button can flip
 *        between Create / Open / Remove.
 *
 * All variants are scoped to the calling therapist by
 * requirePsychologistId — a clinic-admin context still calls as
 * themselves; clinic-wide cross-therapist demos are explicitly out of
 * scope (one therapist, one example client).
 */

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const existing = await findDemoClient(auth.value.psychologistId);
  return NextResponse.json({ clientId: existing?.id ?? null });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const result = await createDemoClient(auth.value.psychologistId, auth.value.psychologistId);
  return NextResponse.json(
    { clientId: result.clientId, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const result = await removeDemoClient(auth.value.psychologistId, auth.value.psychologistId);
  return NextResponse.json({ clientId: result.clientId, removed: result.removed });
}
