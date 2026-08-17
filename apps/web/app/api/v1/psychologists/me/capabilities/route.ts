import { NextResponse, type NextRequest } from 'next/server';
import { EffectiveCapabilitiesSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Transitional endpoint for the unified shell until practitioner routes land. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    EffectiveCapabilitiesSchema.parse({
      profession: auth.value.user.profession,
      capabilities: auth.value.user.capabilities,
      verifiedCredentialKinds: auth.value.user.verifiedCredentialKinds,
    }),
  );
}
