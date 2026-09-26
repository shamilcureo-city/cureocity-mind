import { NextResponse, type NextRequest } from 'next/server';
import { requireScribeDoctor, scribeErrorResponse } from '@/lib/scribe-workspace-auth';
import {
  deleteScribeRecord,
  getScribeRecord,
  updateScribeRecord,
} from '@/lib/scribe-workspace-store';
import {
  ScribeRecordDeleteSchema,
  ScribeShortcutSchema,
  ScribeShortcutUpdateSchema,
  shortcutRequiresPrescribing,
} from '@/lib/scribe-personalization-contracts';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, ScribeShortcutUpdateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await params;
    const scope = { psychologistId: auth.value.psychologistId, kind: 'shortcut' as const };
    const existing = await getScribeRecord(scope, id, ScribeShortcutSchema);
    if (!existing) return NextResponse.json({ error: 'Favorite not found.' }, { status: 404 });
    if (
      shortcutRequiresPrescribing(existing.body) ||
      shortcutRequiresPrescribing(parsed.value.body)
    ) {
      const prescription = await requireScribeDoctor(req, 'PRESCRIPTION_DRAFTING');
      if (!prescription.ok) return prescription.response;
    }
    const record = await updateScribeRecord(scope, id, parsed.value.revision, parsed.value.body);
    return NextResponse.json({ record });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await requireScribeDoctor(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, ScribeRecordDeleteSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await params;
    const scope = { psychologistId: auth.value.psychologistId, kind: 'shortcut' as const };
    const existing = await getScribeRecord(scope, id, ScribeShortcutSchema);
    if (!existing) return NextResponse.json({ error: 'Favorite not found.' }, { status: 404 });
    if (shortcutRequiresPrescribing(existing.body)) {
      const prescription = await requireScribeDoctor(req, 'PRESCRIPTION_DRAFTING');
      if (!prescription.ok) return prescription.response;
    }
    await deleteScribeRecord(scope, id, parsed.value.revision);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return scribeErrorResponse(error);
  }
}
