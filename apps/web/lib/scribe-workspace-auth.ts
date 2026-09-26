import { NextResponse, type NextRequest } from 'next/server';
import type { PractitionerCapability } from '@cureocity/contracts';
import { requireCapability } from './auth-server';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';

export class ScribeWorkspaceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ScribeWorkspaceError';
  }
}

/** Only optimistic-lock conflicts are safe to retry automatically. */
export class ScribeWorkspaceRevisionConflictError extends ScribeWorkspaceError {
  constructor(
    message = 'This item changed in another window. Reload to review the latest version.',
  ) {
    super(409, message);
    this.name = 'ScribeWorkspaceRevisionConflictError';
  }
}

/** Authentication is rechecked at each route, never inferred from visible navigation. */
export async function requireScribeDoctor(
  req: NextRequest,
  capability: PractitionerCapability = 'MEDICAL_DOCUMENTATION',
) {
  const auth = await requireCapability(req, capability);
  if (!auth.ok) return auth;
  if (auth.value.user.vertical !== 'DOCTOR') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'This workspace is for doctors.' }, { status: 403 }),
    };
  }
  return auth;
}

export function scribeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ScribeWorkspaceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ClientPhiWriteForbiddenError) {
    return NextResponse.json(
      { error: 'Patient not found or no longer available.' },
      { status: 404 },
    );
  }
  // Never disclose database messages, patient bodies, uploaded content or tokens.
  return NextResponse.json(
    { error: 'Could not complete this action. Your changes have not been confirmed; try again.' },
    { status: 503 },
  );
}
