import { NextResponse, type NextRequest } from 'next/server';
import { getScribeRecord, updateScribeRecord } from '@/lib/scribe-workspace-store';
import { ScribeIntakeBodySchema, SubmitScribeIntakeSchema } from '@/lib/scribe-intake-contracts';
import {
  intakeFreshnessGuard,
  intakeTokenUsable,
  readIntakeSubmission,
  submittedIntake,
} from '@/lib/scribe-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const unavailable = () =>
  NextResponse.json(
    {
      error:
        'This link is invalid, expired, revoked or already used. Ask the clinic for a new link.',
    },
    { status: 400, headers },
  );

/** Bearer grant: write once, no GET/readback/chart access, no asserted staff identity. */
export async function POST(req: NextRequest) {
  let input: unknown;
  try {
    input = await readIntakeSubmission(req);
  } catch {
    return NextResponse.json(
      { error: 'Submission could not be read. Keep text concise and check the link.' },
      { status: 400, headers },
    );
  }
  const parsed = SubmitScribeIntakeSchema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Please check the submission fields and link.' },
      { status: 400, headers },
    );
  const { psychologistId, recordId, token, report } = parsed.data;
  try {
    const scope = {
      psychologistId,
      kind: 'intake' as const,
      actorType: 'SYSTEM' as const,
      requireUnsigned: true,
    };
    const record = await getScribeRecord(scope, recordId, ScribeIntakeBodySchema);
    if (!record || !record.clientId || !intakeTokenUsable(record.body, token)) return unavailable();
    // The store rechecks active patient/session authority and revision inside its write transaction.
    await updateScribeRecord(
      {
        ...scope,
        clientId: record.clientId,
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
        guard: intakeFreshnessGuard(record.body.expiresAt, record.sessionId ?? undefined),
      },
      recordId,
      record.revision,
      submittedIntake(record.body, report),
    );
    return NextResponse.json({ submitted: true }, { status: 201, headers });
  } catch {
    // Deliberately do not log tokens, author-supplied text, existence or store errors.
    return unavailable();
  }
}
