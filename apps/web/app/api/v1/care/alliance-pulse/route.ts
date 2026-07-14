import { NextResponse, type NextRequest } from 'next/server';
import { CareAlliancePulseInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { parseJson } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * CG2 — POST /api/v1/care/alliance-pulse — the session-3 WAI-SR-short pulse.
 * Working alliance with the persona forms in days 3–5 and predicts retention
 * before any reliable-change verdict exists (Beatty 2022; Woebot bond data) —
 * this is the product's leading indicator, one audit row per pulse. A low
 * bond pairs with the free persona switch in Settings (the escape hatch).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareAlliancePulseInputSchema);
  if (!input.ok) return input.response;

  const { agree, heard, newWays } = input.value;
  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_ALLIANCE_PULSE',
    targetType: 'CareUser',
    targetId: auth.value.careUserId,
    metadata: {
      ...auditMetadataFromRequest(req),
      agree,
      heard,
      newWays,
      mean: Math.round(((agree + heard + newWays) / 3) * 100) / 100,
      personaName: auth.value.careUser.personaName,
      preferredLanguage: auth.value.careUser.preferredLanguage,
    },
  });

  return NextResponse.json({ ok: true });
}
