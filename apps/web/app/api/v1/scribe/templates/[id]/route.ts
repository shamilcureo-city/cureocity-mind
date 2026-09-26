import { NextResponse, type NextRequest } from 'next/server';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import { deleteScribeRecord, updateScribeRecord } from '@/lib/scribe-workspace-store';
import {
  ScribeDoctorTemplateDeleteSchema,
  ScribeDoctorTemplateResponseSchema,
  ScribeDoctorTemplateUpdateSchema,
} from '@/lib/scribe-doctor-templates';
import {
  readScribeDoctorTemplate,
  readScribeTemplateJson,
  scribeDoctorTemplateScope,
} from '@/lib/scribe-doctor-template-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cache = 'private, no-store';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: NextRequest, { params }: Context) {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cache);
    return auth.response;
  }
  try {
    const input = ScribeDoctorTemplateUpdateSchema.safeParse(await readScribeTemplateJson(req));
    if (!input.success)
      throw new ScribeWorkspaceError(
        400,
        'Check the template settings, revision and patient-data confirmation.',
      );
    const { id } = await params;
    const owner = auth.value.psychologistId;
    const existing = await readScribeDoctorTemplate(owner, id);
    if (existing.revision !== input.data.revision)
      throw new ScribeWorkspaceError(409, 'This template changed. Reload before editing.');
    const record = await updateScribeRecord(
      scribeDoctorTemplateScope(owner),
      id,
      input.data.revision,
      { ...existing.body, template: input.data.template },
    );
    return NextResponse.json(ScribeDoctorTemplateResponseSchema.parse({ record }), {
      headers: { 'Cache-Control': cache },
    });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', cache);
    return response;
  }
}
export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cache);
    return auth.response;
  }
  try {
    const input = ScribeDoctorTemplateDeleteSchema.safeParse(await readScribeTemplateJson(req));
    if (!input.success)
      throw new ScribeWorkspaceError(400, 'A current template revision is required.');
    const { id } = await params;
    const owner = auth.value.psychologistId;
    const existing = await readScribeDoctorTemplate(owner, id);
    if (existing.revision !== input.data.revision)
      throw new ScribeWorkspaceError(409, 'This template changed. Reload before deleting.');
    await deleteScribeRecord(scribeDoctorTemplateScope(owner), id, input.data.revision);
    return NextResponse.json(
      { deletedId: id, revision: input.data.revision },
      { headers: { 'Cache-Control': cache } },
    );
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', cache);
    return response;
  }
}
