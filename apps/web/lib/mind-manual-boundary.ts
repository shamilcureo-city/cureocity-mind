import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from './prisma';
import { regulatedPolicyForRequest } from './regulated-route-capabilities';

// Operation-specific: clinician-authored diagnoses, formulation, plans, edits,
// signing and exports remain available. A clinical capability is not an AI opt-in.
export const MANUAL_SESSION_BLOCKED_OPERATIONS = new Set([
  'start',
  'end',
  'live-token',
  'live-note',
  'live-suggestion',
  'live-metric',
  'consent-recovery',
  'capture-resume',
  'recovery-transcript',
  'generate-note',
  'clinical-analysis',
  'differential',
  'note/modify',
  'plan-dictation',
  'note-draft',
  'note/edit',
  'note-edit-recovery',
]);

export function manualBoundarySessionId(
  req: Pick<NextRequest, 'url' | 'method' | 'headers'>,
): string | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;
  const pathname = new URL(req.url).pathname.replace(/\/$/, '');
  if (pathname === '/api/v1/audio/chunks/upload') return req.headers.get('x-session-id');
  const policy = regulatedPolicyForRequest(pathname, req.method);
  const canonical = policy?.aliasOf ?? policy?.route;
  const operation = canonical?.replace(/^api\/v1\/sessions\/\[id\]\//, '');
  if (!operation || !MANUAL_SESSION_BLOCKED_OPERATIONS.has(operation)) return null;
  const encodedId = pathname.split('/')[4];
  try {
    return encodedId ? decodeURIComponent(encodedId) : null;
  } catch {
    return null;
  }
}

/** Runs after identity/capability checks and before body ingestion/model work. */
export async function enforceManualSessionBoundary(
  req: NextRequest,
  psychologistId: string,
): Promise<NextResponse | null> {
  const id = manualBoundarySessionId(req);
  if (!id) return null;
  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      psychologistId: true,
      mindDocumentationMode: true,
      client: { select: { deletedAt: true } },
    },
  });
  if (!session || session.psychologistId !== psychologistId || session.client.deletedAt !== null) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.mindDocumentationMode !== 'MANUAL') return null;
  const alternateEditor = /\/(?:note-draft|note\/edit|note-edit-recovery)\/?$/.test(
    new URL(req.url).pathname,
  );
  return NextResponse.json(
    {
      error: alternateEditor
        ? 'Use the clinician-written workspace to edit this note. It keeps your draft, review and signature together.'
        : 'This is a clinician-written session. Recording and session AI processing are disabled. Continue in your note.',
      code: 'MIND_MANUAL_SESSION',
    },
    { status: 409 },
  );
}
