import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import {
  createScribeRecord,
  getScribeRecord,
  updateScribeRecord,
} from '@/lib/scribe-workspace-store';
import {
  ScribeNoteStyleSchema,
  ScribeNoteStyleUpdateSchema,
} from '@/lib/scribe-personalization-contracts';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const record = await getScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'note_style' },
      `note-style-${auth.value.psychologistId}`,
      ScribeNoteStyleSchema,
    );
    return NextResponse.json({ record }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, ScribeNoteStyleUpdateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const scope = { psychologistId: auth.value.psychologistId, kind: 'note_style' as const };
    const id = `note-style-${auth.value.psychologistId}`;
    const record =
      parsed.value.revision === 0
        ? await createScribeRecord(scope, parsed.value.body, id)
        : await updateScribeRecord(scope, id, parsed.value.revision, parsed.value.body);
    return NextResponse.json({ record });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
