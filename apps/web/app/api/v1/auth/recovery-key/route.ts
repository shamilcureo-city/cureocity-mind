import { createHmac, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { privateJson, privateResponse } from '@/lib/private-response';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';

export const dynamic = 'force-dynamic';

/** The browser receives this key only after authenticating as the visit owner. */
export async function GET(req: NextRequest) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return privateResponse(auth.response);
  const { psychologistId } = auth.value;
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId || sessionId.length > 128)
    return privateJson({ error: 'A session is required' }, { status: 400 });
  try {
    const key = await prisma.$transaction(async (tx) => {
      // Distinct from tenant DEK provisioning: encryptForTenant can provision
      // that key independently without re-entering this advisory lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`browser-recovery:${psychologistId}`}))`;
      const account = await tx.psychologist.findFirst({
        where: { id: psychologistId, status: 'ACTIVE', deletedAt: null },
        select: { browserRecoveryKeyEncrypted: true },
      });
      if (!account) return null;
      const session = await tx.session.findFirst({
        where: { id: sessionId, psychologistId, client: { psychologistId, deletedAt: null } },
        select: { id: true },
      });
      if (!session) return null;
      if (account.browserRecoveryKeyEncrypted) {
        const existing = await decryptForTenant(
          psychologistId,
          account.browserRecoveryKeyEncrypted,
        );
        if (
          !existing ||
          !/^[A-Za-z0-9+/]{43}=$/.test(existing) ||
          Buffer.from(existing, 'base64').length !== 32
        )
          throw new Error('Recovery key unavailable');
        return existing;
      }
      const generated = randomBytes(32).toString('base64');
      const encrypted = await encryptForTenant(psychologistId, generated);
      const saved = await tx.psychologist.updateMany({
        where: {
          id: psychologistId,
          status: 'ACTIVE',
          deletedAt: null,
          browserRecoveryKeyEncrypted: null,
        },
        data: { browserRecoveryKeyEncrypted: encrypted },
      });
      if (saved.count !== 1) throw new Error('Recovery key unavailable');
      return generated;
    });
    if (!key) return privateJson({ error: 'Session not found' }, { status: 404 });
    // The account master never leaves the server. A key released for one
    // authorized visit must not unlock copies from another, now-denied visit.
    const sessionKey = createHmac('sha256', Buffer.from(key, 'base64'))
      .update(JSON.stringify(['mind-browser-recovery', 1, psychologistId, sessionId]))
      .digest('base64');
    return privateJson({ accountId: psychologistId, sessionId, key: sessionKey });
  } catch {
    // Never log key material, ciphertext or transcript-bearing browser state.
    return privateJson(
      { error: 'Secure browser recovery is temporarily unavailable' },
      { status: 503 },
    );
  }
}
