/**
 * Cureocity Mind — development seed.
 *
 * Idempotent: re-running this script must not duplicate records or fail.
 * Run with: `pnpm db:seed`. Vercel build re-runs it on every deploy.
 *
 * Creates one demo Psychologist (Dr. Priya Menon) plus one Client
 * (Arjun Rao) paired to the demo Firebase UID, with three GRANTED
 * consents. IDs are auto-generated cuids — never hardcoded — so they
 * satisfy the CuidSchema validator in @cureocity/contracts.
 *
 * A one-time cleanup at the top removes legacy non-cuid seed rows from
 * earlier builds (id starts with "seed-") so the prod DB can converge
 * without a manual migration.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PSYCHOLOGIST_UID = 'dev-firebase-uid-priya';
const DEMO_CLIENT_UID = 'dev-client-firebase-uid-arjun';

async function cleanupLegacySeedRows(): Promise<void> {
  // Earlier seed iterations hardcoded ids like "seed-client-arjun" which
  // fail CuidSchema validation on POST /sessions. Sweep them and their
  // dependents so the new cuid-keyed rows can coexist.
  const legacyClient = await prisma.client.findUnique({
    where: { id: 'seed-client-arjun' },
    select: { id: true },
  });
  if (legacyClient) {
    await prisma.geminiCallLog.updateMany({
      where: { session: { clientId: 'seed-client-arjun' } },
      data: { sessionId: null },
    });
    await prisma.noteEdit.deleteMany({
      where: { therapyNote: { session: { clientId: 'seed-client-arjun' } } },
    });
    await prisma.therapyNote.deleteMany({
      where: { session: { clientId: 'seed-client-arjun' } },
    });
    await prisma.noteDraft.deleteMany({
      where: { session: { clientId: 'seed-client-arjun' } },
    });
    await prisma.audioChunk.deleteMany({
      where: { session: { clientId: 'seed-client-arjun' } },
    });
    await prisma.session.deleteMany({ where: { clientId: 'seed-client-arjun' } });
    await prisma.consent.deleteMany({ where: { clientId: 'seed-client-arjun' } });
    await prisma.client.delete({ where: { id: 'seed-client-arjun' } });
    console.log('Removed legacy non-cuid seed client + dependents.');
  }
}

async function main(): Promise<void> {
  await cleanupLegacySeedRows();

  const psychologist = await prisma.psychologist.upsert({
    where: { firebaseUid: DEMO_PSYCHOLOGIST_UID },
    update: {},
    create: {
      firebaseUid: DEMO_PSYCHOLOGIST_UID,
      email: 'priya.menon@example.in',
      fullName: 'Dr. Priya Menon',
      phone: '+919876543210',
      rciNumber: 'A12345',
      rciVerifiedAt: new Date('2024-01-15T00:00:00Z'),
      status: 'ACTIVE',
    },
  });

  // Client is keyed by clientFirebaseUid (it's @unique) so the demo
  // auth-bypass in apps/web/lib/auth-server.ts can resolve it.
  const existingClient = await prisma.client.findUnique({
    where: { clientFirebaseUid: DEMO_CLIENT_UID },
  });
  const client =
    existingClient ??
    (await prisma.client.create({
      data: {
        psychologistId: psychologist.id,
        clientFirebaseUid: DEMO_CLIENT_UID,
        fullName: 'Arjun Rao',
        contactPhone: '+919812345678',
        contactEmail: 'arjun.rao@example.in',
        dateOfBirth: new Date('1992-03-14'),
        presentingConcerns: 'Generalised anxiety; sleep disruption; work-related rumination.',
        preferredModality: 'CBT',
        status: 'ACTIVE',
      },
    }));

  const scopes = ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'] as const;
  for (const scope of scopes) {
    const existing = await prisma.consent.findFirst({
      where: { clientId: client.id, scope, status: 'GRANTED' },
      select: { id: true },
    });
    if (!existing) {
      await prisma.consent.create({
        data: {
          clientId: client.id,
          psychologistId: psychologist.id,
          scope,
          status: 'GRANTED',
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON',
          grantedAt: new Date(),
        },
      });
    }
  }

  console.log('Seed complete:');
  console.log(`  Psychologist: ${psychologist.fullName} (${psychologist.id})`);
  console.log(`  Client: ${client.fullName} (${client.id})`);
  console.log(`  Client Firebase UID: ${client.clientFirebaseUid}`);
  console.log('  Consents: AUDIO_RECORDING, AI_NOTE_GENERATION, CROSS_BORDER_PROCESSING');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
