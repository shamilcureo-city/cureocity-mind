import { NextResponse, type NextRequest } from 'next/server';
import {
  CreateInviteCodeInputSchema,
  type ListInviteCodesResponse,
} from '@cureocity/contracts';
import { requireAdmin } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { mintInviteCode, toInviteCode } from '@/lib/invite';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/invite-codes — list all pilot invite codes (admin).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.pilotInviteCode.findMany({ orderBy: { createdAt: 'desc' } });
  const body: ListInviteCodesResponse = { items: rows.map(toInviteCode) };
  return NextResponse.json(body);
}

/**
 * POST /api/v1/admin/invite-codes — mint a code (admin).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CreateInviteCodeInputSchema);
  if (!input.ok) return input.response;

  const row = await mintInviteCode({
    label: input.value.label,
    maxUses: input.value.maxUses ?? 1,
    expiresAt: input.value.expiresAt ? new Date(input.value.expiresAt) : null,
    createdByPsychologistId: auth.value.psychologistId,
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PILOT_INVITE_CREATED',
    targetType: 'PilotInviteCode',
    targetId: row.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      code: row.code,
      maxUses: row.maxUses,
      label: row.label,
    },
  });

  return NextResponse.json({ inviteCode: toInviteCode(row) }, { status: 201 });
}
