import type { NextRequest, NextResponse } from 'next/server';
import { GET as getPatients, POST as createPatient } from '../patients/route';
import { markLegacyPatientResponse } from '@/lib/patient-compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** @deprecated Use /api/v1/patients. Retained during the ORBIT migration. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return markLegacyPatientResponse(await getPatients(req), '/api/v1/patients');
}

/** @deprecated Use /api/v1/patients. Retained during the ORBIT migration. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return markLegacyPatientResponse(await createPatient(req), '/api/v1/patients');
}
