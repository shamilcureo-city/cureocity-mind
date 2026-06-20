import { NextResponse, type NextRequest } from 'next/server';
import { BeginRegistrationInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { generateChallenge, signRegistrationTicket, ticketTtlMs } from '@/lib/webauthn-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/psychologists/me/webauthn-credentials/begin-registration
 *
 * Generates a fresh WebAuthn challenge + a short-lived signed ticket.
 * The ticket carries (psychologistId, challenge, expiresAt) HMAC'd
 * with the server secret — no DB row needed.
 *
 * The client then calls `navigator.credentials.create()` with the
 * options below and posts the result to /finish-registration with
 * the same ticket.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  // Body is optional; tolerate both missing JSON and an empty object.
  const bodyText = await req.text().catch(() => '');
  let labelHint: string | undefined;
  if (bodyText.length > 0) {
    const fakeReq = new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText,
    });
    const parsed = await parseJson(fakeReq, BeginRegistrationInputSchema);
    if (!parsed.ok) return parsed.response;
    labelHint = parsed.value?.label;
  }
  void labelHint; // label is stored at /finish, not here

  const psy = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { id: true, fullName: true, email: true },
  });
  if (!psy) return NextResponse.json({ error: 'Psychologist not found' }, { status: 404 });

  const existing = await prisma.webAuthnCredential.findMany({
    where: { psychologistId: auth.value.psychologistId, revokedAt: null },
    select: { credentialId: true },
  });

  const challenge = generateChallenge();
  const ticket = signRegistrationTicket({
    psychologistId: auth.value.psychologistId,
    challenge,
    expiresAt: Date.now() + ticketTtlMs(),
  });

  const rpId = process.env['WEBAUTHN_RP_ID'] ?? new URL(req.url).hostname;
  const rpName = process.env['WEBAUTHN_RP_NAME'] ?? 'Cureocity Mind';

  return NextResponse.json({
    challenge,
    ticket,
    rpId,
    rpName,
    user: {
      // base64url of the psychologistId — WebAuthn user.id is bytes.
      id: Buffer.from(psy.id, 'utf8').toString('base64url'),
      name: psy.email,
      displayName: psy.fullName,
    },
    excludeCredentialIds: existing.map((c) => c.credentialId),
    timeoutSec: Math.floor(ticketTtlMs() / 1000),
  });
}
