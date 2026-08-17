import type { NextRequest, NextResponse } from 'next/server';
import { GET as getPatient, PATCH as updatePatient } from '../../patients/[id]/route';
import { markLegacyPatientResponse } from '@/lib/patient-compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** @deprecated Use /api/v1/patients/:id. Retained during the ORBIT migration. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { id } = await ctx.params;
  return markLegacyPatientResponse(await getPatient(req, ctx), `/api/v1/patients/${id}`);
}

/** @deprecated Use /api/v1/patients/:id. Retained during the ORBIT migration. */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { id } = await ctx.params;
  return markLegacyPatientResponse(await updatePatient(req, ctx), `/api/v1/patients/${id}`);
}
