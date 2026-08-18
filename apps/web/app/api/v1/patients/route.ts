import type { NextRequest, NextResponse } from 'next/server';
import { GET as legacyGET, POST as legacyPOST } from '../clients/route';
import { stripLegacyPatientHeaders } from '@/lib/patient-compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return stripLegacyPatientHeaders(await legacyGET(req), '/api/v1/patients');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return stripLegacyPatientHeaders(await legacyPOST(req), '/api/v1/patients');
}
