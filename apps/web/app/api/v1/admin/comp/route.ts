import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-server';
import { CompError, compAccount, isCompTier } from '@/lib/comp';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/comp — admin-gated account comp.
 *
 * Bypass Razorpay for one therapist: upsert their BillingAccount onto a
 * paid tier with `paidThroughAt = now + months × 30d`. Idempotent — a
 * re-run refreshes paidThroughAt and writes another audit row (each one
 * IS a distinct operator action). Audit row carries `metadata.comp=true`
 * so the funnel dashboard can disaggregate comped MRR from real revenue.
 *
 * The operator field is filled from the calling admin's email so the
 * audit trail attributes the action to a human, not a script.
 */
const CompInputSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .regex(/^\+?\d+$/, 'phone must be digits, optionally +-prefixed (E.164)'),
  tier: z.string().refine(isCompTier, 'tier must be PRO|PREMIUM|STARTER|TRAINEE'),
  months: z.number().int().min(1).max(120),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CompInputSchema);
  if (!body.ok) return body.response;

  try {
    const result = await compAccount({
      phone: body.value.phone,
      tier: body.value.tier as 'PRO' | 'PREMIUM' | 'STARTER' | 'TRAINEE',
      months: body.value.months,
      operator: auth.value.user.email ?? auth.value.user.firebaseUid,
      reason: body.value.reason,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CompError) {
      const status = e.code === 'PSY_NOT_FOUND' ? 404 : e.code === 'PSY_DELETED' ? 410 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
}
