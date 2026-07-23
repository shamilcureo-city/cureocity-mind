/**
 * CLI wrapper for the demo/pilot practitioner seed.
 *
 * All the data + logic lives in `apps/web/lib/demo-seed.ts` (one source of
 * truth, shared with the `app/api/v1/ops/seed-demo` endpoint). This file just
 * opens a Prisma client, runs it, and prints a summary.
 *
 * Run:    DATABASE_URL=postgresql://... pnpm exec tsx scripts/seed-south-india.ts
 * Undo:   DATABASE_URL=... pnpm exec tsx scripts/seed-south-india.ts --purge
 *
 * NOTE: from an environment that can't open a direct DB connection (e.g. the
 * Claude sandbox, whose egress policy blocks Neon), use the ops endpoint
 * instead — it runs the same `seedDemo()` from inside the deployed app.
 */

import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../apps/web/lib/demo-seed';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const purge = process.argv.includes('--purge');
  const s = await seedDemo(prisma, { purge });

  if (purge) {
    console.log(`Purged ${s.purged ?? 0} seed practitioners + their clients + sessions.`);
    return;
  }

  console.log('\nSeed complete.');
  console.log(`  Practitioners: ${s.practitioners} (${s.therapist} therapist · ${s.doctor} doctor)`);
  console.log(`  Clients:       ${s.clients}`);
  console.log(`  Sessions:      ${s.sessions} (${s.sessionsLast7d} in the last 7d)`);
  console.log(`    South India: ${s.southIndia.total} — [${s.southIndia.distribution.join(', ')}]`);
  console.log(`    UAE:         ${s.uae.total} — [${s.uae.distribution.join(', ')}]`);
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
