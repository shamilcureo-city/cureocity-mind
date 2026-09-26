import { NextResponse, type NextRequest } from 'next/server';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import {
  ScribeDoctorTemplateCreateSchema,
  ScribeDoctorTemplateResponseSchema,
} from '@/lib/scribe-doctor-templates';
import {
  createScribeDoctorTemplate,
  readScribeDoctorTemplates,
  readScribeTemplateJson,
} from '@/lib/scribe-doctor-template-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cache = 'private, no-store';
export async function GET(req: NextRequest) {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cache);
    return auth.response;
  }
  try {
    return NextResponse.json(await readScribeDoctorTemplates(auth.value.psychologistId), {
      headers: { 'Cache-Control': cache },
    });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', cache);
    return response;
  }
}
export async function POST(req: NextRequest) {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cache);
    return auth.response;
  }
  try {
    const input = ScribeDoctorTemplateCreateSchema.safeParse(await readScribeTemplateJson(req));
    if (!input.success)
      throw new ScribeWorkspaceError(
        400,
        'Check the template settings and confirm it contains no patient data.',
      );
    const result = await createScribeDoctorTemplate(auth.value.psychologistId, input.data);
    return NextResponse.json(ScribeDoctorTemplateResponseSchema.parse({ record: result.record }), {
      status: result.created ? 201 : 200,
      headers: { 'Cache-Control': cache },
    });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', cache);
    return response;
  }
}
