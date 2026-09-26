import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { listScribeRecords, createScribeRecord } from '@/lib/scribe-workspace-store';
import {
  InstructionLanguageSchema,
  InstructionsBodySchema,
} from '@/lib/scribe-instructions-schema';
import {
  readSignedInstructionSource,
  assertInstructionSourceCurrent,
  draftSignedInstructions,
} from '@/lib/scribe-instructions-source';
import { assertInstructionTranslationConsent } from '@/lib/scribe-document-ai';
import { boundedDocumentJson, ScribeDocumentError } from '@/lib/scribe-document-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
const IdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const sessionId = IdSchema.safeParse(req.nextUrl.searchParams.get('sessionId'));
    if (!sessionId.success) throw new ScribeDocumentError(400, 'Choose an encounter.');
    const psychologistId = auth.value.psychologistId;
    const source = await readSignedInstructionSource(psychologistId, sessionId.data);
    const records = await listScribeRecords(
      {
        psychologistId,
        kind: 'instructions',
        clientId: source.clientId,
        sessionId: sessionId.data,
        limit: 20,
      },
      InstructionsBodySchema,
    );
    return NextResponse.json(
      {
        records: records.map((record) => ({
          ...record,
          sourceCurrent: record.body.sourceHash === source.sourceHash,
        })),
      },
      { headers },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const input = z
      .object({ sessionId: IdSchema, language: InstructionLanguageSchema })
      .strict()
      .safeParse(await boundedDocumentJson(req));
    if (!input.success)
      throw new ScribeDocumentError(400, 'Choose an encounter and instruction language.');
    const psychologistId = auth.value.psychologistId;
    const source = await readSignedInstructionSource(psychologistId, input.data.sessionId);
    if (input.data.language !== 'source')
      await assertInstructionTranslationConsent(
        psychologistId,
        source.clientId,
        input.data.sessionId,
      );
    const body = await draftSignedInstructions(source.note, input.data.language, {
      psychologistId,
      clientId: source.clientId,
      sessionId: input.data.sessionId,
    });
    const currentAuth = await requireScribeDoctor(req);
    if (!currentAuth.ok) return currentAuth.response;
    const record = await createScribeRecord(
      {
        psychologistId,
        kind: 'instructions',
        clientId: source.clientId,
        sessionId: input.data.sessionId,
        guard: async (tx) => {
          await assertInstructionSourceCurrent(
            psychologistId,
            input.data.sessionId,
            source.clientId,
            body.sourceHash,
            tx,
          );
          if (input.data.language !== 'source')
            await assertInstructionTranslationConsent(
              psychologistId,
              source.clientId,
              input.data.sessionId,
              tx,
            );
        },
      },
      body,
    );
    return NextResponse.json(
      { record: { ...record, sourceCurrent: true } },
      { status: 201, headers },
    );
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
