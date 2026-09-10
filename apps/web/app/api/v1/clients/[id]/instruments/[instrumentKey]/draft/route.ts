import { NextResponse, type NextRequest } from 'next/server';
import { InstrumentKeySchema, MindInstrumentDraftInputSchema } from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { writeAudit } from '@/lib/audit';
import { ClientPhiWriteForbiddenError, lockActiveClient } from '@/lib/phi-write-lock';
import {
  MindInstrumentDraftError,
  instrumentDraftState,
  mutateInstrumentDraft,
} from '@/lib/mind-instrument-draft-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; instrumentKey: string }> };
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const missing = () => NextResponse.json({ error: 'Client not found' }, { status: 404, headers });

async function authorize(
  req: NextRequest,
  auth: Awaited<ReturnType<typeof requirePsychologistId>>,
) {
  if (!auth.ok) return auth;
  const measurement = await requireCapability(req, 'MEASUREMENT_BASED_CARE', auth);
  if (!measurement.ok) return measurement;
  return requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', measurement);
}

function errorResponse(error: unknown): NextResponse | null {
  if (error instanceof ClientPhiWriteForbiddenError) return missing();
  if (error instanceof MindInstrumentDraftError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  return null;
}

async function handle(
  req: NextRequest,
  ctx: Context,
  write: boolean,
  authenticated: Awaited<ReturnType<typeof requirePsychologistId>>,
): Promise<NextResponse> {
  const auth = await authorize(req, authenticated);
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST') return missing();
  const { id: clientId, instrumentKey: rawKey } = await ctx.params;
  const key = InstrumentKeySchema.safeParse(rawKey);
  if (!key.success)
    return NextResponse.json({ error: 'Unknown questionnaire' }, { status: 404, headers });
  const body = write ? await parseJson(req, MindInstrumentDraftInputSchema) : null;
  if (body && !body.ok) return body.response;
  try {
    const state = await prisma.$transaction(
      async (tx) => {
        await lockActiveClient(tx, clientId, auth.value.psychologistId);
        const client = await tx.client.findFirst({
          where: {
            id: clientId,
            psychologistId: auth.value.psychologistId,
            deletedAt: null,
            ...(write ? { status: 'ACTIVE' as const } : {}),
            psychologist: { vertical: 'THERAPIST' },
          },
          select: { id: true },
        });
        if (!client) throw new ClientPhiWriteForbiddenError();
        if (body?.ok)
          return mutateInstrumentDraft(
            tx,
            { clientId, psychologistId: auth.value.psychologistId, instrumentKey: key.data },
            body.value,
          );
        const row = await tx.mindInstrumentDraft.findUnique({
          where: { clientId_instrumentKey: { clientId, instrumentKey: key.data } },
        });
        if (row && row.psychologistId !== auth.value.psychologistId)
          throw new ClientPhiWriteForbiddenError();
        const value = await instrumentDraftState(key.data, row);
        if (row)
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: auth.value.psychologistId,
              action: 'MIND_INSTRUMENT_DRAFT_VIEWED',
              targetType: 'MindInstrumentDraft',
              targetId: clientId,
              metadata: { clientId, instrumentKey: key.data, revision: row.revision },
            },
            tx,
          );
        return value;
      },
      { timeout: 15_000 },
    );
    return NextResponse.json(state, { headers });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  return handle(req, ctx, false, auth);
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  return handle(req, ctx, true, auth);
}
