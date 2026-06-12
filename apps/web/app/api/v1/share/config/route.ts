import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { shareChannels } from '@/lib/share-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/share/config
 *
 * Sprint 43 — tells the share modal which send channels are actually
 * configured on this deployment so it can grey out a channel the
 * server can't deliver on (WATI / SendGrid env unset → NoopBackend),
 * rather than letting the therapist send into a silent no-op.
 *
 * Returns only booleans — never any credential material.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const channels = shareChannels();
  return NextResponse.json({
    whatsappConfigured: channels.whatsappReady,
    emailConfigured: channels.emailReady,
  });
}
