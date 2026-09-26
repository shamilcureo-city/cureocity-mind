import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import { createScribeRecord, listScribeRecords } from '@/lib/scribe-workspace-store';
import {
  ScribeShortcutSchema,
  shortcutRequiresPrescribing,
} from '@/lib/scribe-personalization-contracts';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  try {
    const records = await listScribeRecords(
      { psychologistId: auth.value.psychologistId, kind: 'shortcut' },
      ScribeShortcutSchema,
    );
    return NextResponse.json({ records }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, ScribeShortcutSchema);
  if (!parsed.ok) return parsed.response;
  if (shortcutRequiresPrescribing(parsed.value)) {
    const prescription = await requireScribeDoctor(req, 'PRESCRIPTION_DRAFTING');
    if (!prescription.ok) return prescription.response;
  }
  try {
    const record = await createScribeRecord(
      { psychologistId: auth.value.psychologistId, kind: 'shortcut' },
      parsed.value,
    );
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
