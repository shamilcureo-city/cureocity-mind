/**
 * Cureocity Mind — development seed.
 *
 * Idempotent: re-running this script must not duplicate records or fail.
 * Run with: `pnpm db:seed`
 *
 * Creates a single demo Psychologist with one active Client and one granted
 * AUDIO_RECORDING consent. Enough to exercise every Sprint 1 endpoint
 * end-to-end against a local Postgres.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const psychologist = await prisma.psychologist.upsert({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    update: {},
    create: {
      firebaseUid: 'dev-firebase-uid-priya',
      email: 'priya.menon@example.in',
      fullName: 'Dr. Priya Menon',
      phone: '+919876543210',
      rciNumber: 'A12345',
      rciVerifiedAt: new Date('2024-01-15T00:00:00Z'),
      status: 'ACTIVE',
    },
  });

  const client = await prisma.client.upsert({
    where: { id: 'seed-client-arjun' },
    update: {},
    create: {
      id: 'seed-client-arjun',
      psychologistId: psychologist.id,
      fullName: 'Arjun Rao',
      contactPhone: '+919812345678',
      contactEmail: 'arjun.rao@example.in',
      dateOfBirth: new Date('1992-03-14'),
      presentingConcerns: 'Generalised anxiety; sleep disruption; work-related rumination.',
      preferredModality: 'CBT',
      status: 'ACTIVE',
    },
  });

  await prisma.consent.upsert({
    where: { id: 'seed-consent-arjun-audio' },
    update: {},
    create: {
      id: 'seed-consent-arjun-audio',
      clientId: client.id,
      psychologistId: psychologist.id,
      scope: 'AUDIO_RECORDING',
      status: 'GRANTED',
      scriptVersion: 'v1.0',
      capturedVia: 'IN_PERSON',
      grantedAt: new Date(),
    },
  });

  await prisma.consent.upsert({
    where: { id: 'seed-consent-arjun-ai' },
    update: {},
    create: {
      id: 'seed-consent-arjun-ai',
      clientId: client.id,
      psychologistId: psychologist.id,
      scope: 'AI_NOTE_GENERATION',
      status: 'GRANTED',
      scriptVersion: 'v1.0',
      capturedVia: 'IN_PERSON',
      grantedAt: new Date(),
    },
  });

  await prisma.consent.upsert({
    where: { id: 'seed-consent-arjun-cross-border' },
    update: {},
    create: {
      id: 'seed-consent-arjun-cross-border',
      clientId: client.id,
      psychologistId: psychologist.id,
      scope: 'CROSS_BORDER_PROCESSING',
      status: 'GRANTED',
      scriptVersion: 'v1.0',
      capturedVia: 'IN_PERSON',
      grantedAt: new Date(),
    },
  });

  console.log('Seed complete:');
  console.log(`  Psychologist: ${psychologist.fullName} (${psychologist.id})`);
  console.log(`  Client: ${client.fullName} (${client.id})`);
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
