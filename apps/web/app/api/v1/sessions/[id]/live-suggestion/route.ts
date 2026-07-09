import { NextResponse, type NextRequest } from 'next/server';
import { LiveSuggestionEventSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS3 — POST /api/v1/sessions/:id/live-suggestion
 *
 * The streaming gateway surfaces live copilot suggestions but can't touch the
 * DB, so the browser relays each lifecycle event here and we write one audit
 * row: shown / acted / dismissed / auto-resolved. This is both the safety
 * trail (what the copilot showed + what the doctor did about it) and the
 * pilot dataset. Doctor-only, tenant-checked, POST-only (a side effect must
 * never be reachable by a prefetched GET — see docs/AUTH_SESSION.md).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const parsed = await parseJson(req, LiveSuggestionEventSchema);
  if (!parsed.ok) return parsed.response;
  const ev = parsed.value;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  // Sprint TS1 — both verticals relay live copilot suggestion lifecycle events.

  const metadata = {
    sessionId,
    suggestionId: ev.suggestionId,
    kind: ev.kind,
    ...(ev.label ? { label: ev.label } : {}),
    // Sprint DS9 — the 1-tap dismiss reason, for the pilot acceptance dataset.
    ...(ev.dismissReason ? { dismissReason: ev.dismissReason } : {}),
    ...auditMetadataFromRequest(req),
  };
  const base = {
    actorType: 'PSYCHOLOGIST' as const,
    actorPsychologistId: auth.value.psychologistId,
    targetType: 'LiveSuggestion',
    targetId: ev.suggestionId,
    metadata,
  };

  // Literal action per branch so the audit-coverage chaos test discovers each
  // writer (a ternary would not match its regex — CLAUDE.md §4).
  if (ev.event === 'shown') {
    await writeAudit({ ...base, action: 'LIVE_SUGGESTION_SHOWN' });
  } else if (ev.event === 'acted') {
    await writeAudit({ ...base, action: 'LIVE_SUGGESTION_ACTED' });
  } else if (ev.event === 'dismissed') {
    await writeAudit({ ...base, action: 'LIVE_SUGGESTION_DISMISSED' });
  } else {
    await writeAudit({ ...base, action: 'LIVE_SUGGESTION_AUTORESOLVED' });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
