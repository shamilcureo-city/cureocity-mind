import type { NextRequest, NextResponse } from 'next/server';
import {
  DELETE as legacyDELETE,
  GET as legacyGET,
  PATCH as legacyPATCH,
} from '../../clients/[id]/route';
import { stripLegacyPatientHeaders } from '@/lib/patient-compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function canonicalPath(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  return `/api/v1/patients/${id}`;
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return stripLegacyPatientHeaders(await legacyGET(req, ctx), await canonicalPath(ctx));
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return stripLegacyPatientHeaders(await legacyPATCH(req, ctx), await canonicalPath(ctx));
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return stripLegacyPatientHeaders(await legacyDELETE(req, ctx), await canonicalPath(ctx));
}
