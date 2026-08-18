import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { EffectiveCapabilitiesSchema } from '@cureocity/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    EffectiveCapabilitiesSchema.parse({
      profession: auth.value.user.profession ?? null,
      capabilities: auth.value.user.capabilities ?? [],
      verifiedCredentialKinds: auth.value.user.verifiedCredentialKinds ?? [],
    }),
  );
}
