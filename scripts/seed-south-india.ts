/**
 * Explicit CLI for the isolated September 2026 synthetic activity dataset.
 *
 * Preview (no DB writes):
 *   pnpm exec tsx scripts/seed-south-india.ts
 *
 * Replace the reserved seed cohort on the intended test database:
 *   DATABASE_URL=postgresql://... pnpm exec tsx scripts/seed-south-india.ts --apply
 *
 * Remove only reserved `seed-*` / `demo-load-*` practitioners and their
 * clients/sessions:
 *   DATABASE_URL=postgresql://... pnpm exec tsx scripts/seed-south-india.ts --purge
 *
 * Apply prisma/migrations/20260929000000_synthetic_practitioner_isolation
 * before `--apply`. There is deliberately no deployed HTTP mutation route.
 */

import { PrismaClient } from '@prisma/client';

import { buildDemoLoadPlan } from '../apps/web/lib/demo-load-plan';
import { seedDemo } from '../apps/web/lib/demo-seed';

function printPreview(): void {
  const plan = buildDemoLoadPlan();
  const doctorTotal = plan.days.reduce((sum, day) => sum + day.doctorEncounterTotal, 0);
  const psychologistTotal = plan.days.reduce((sum, day) => sum + day.psychologistEncounterTotal, 0);
  const doctorDaily = plan.days.map((day) => day.doctorEncounterTotal);

  console.log('\nSynthetic load preview — no database writes were made.');
  console.log(`  Period:         ${plan.startDate} through ${plan.endDate}`);
  console.log('  UAE doctors:    112 with TEST-DHA-2026-* identifiers');
  console.log(
    `  Doctor visits:  ${doctorTotal.toLocaleString('en-IN')} (${Math.min(...doctorDaily)}–${Math.max(...doctorDaily)} per day)`,
  );
  console.log('  Psychologists:  89 synthetic Indian accounts');
  console.log(`  Mind visits:    ${psychologistTotal.toLocaleString('en-IN')} (250 per day)`);
  console.log(
    `  Demo clients:   ${plan.clients.length.toLocaleString('en-IN')} (one per synthetic practitioner)`,
  );
  console.log(`  Sessions:       ${plan.sessions.length.toLocaleString('en-IN')}`);
  console.log('\nRun again with --apply against the intended test database to replace the cohort.');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const purge = process.argv.includes('--purge');
  if (apply && purge) throw new Error('Choose either --apply or --purge, not both.');
  if (!apply && !purge) {
    printPreview();
    return;
  }

  const prisma = new PrismaClient();
  try {
    const summary = await seedDemo(prisma, { purge });
    if (purge) {
      console.log(`Purged ${summary.purged} reserved synthetic practitioners and owned data.`);
      return;
    }

    console.log('\nSynthetic seed complete.');
    console.log(`  Replaced:       ${summary.purged} prior synthetic practitioners`);
    console.log(
      `  Practitioners:  ${summary.practitioners} (${summary.doctor} UAE doctor · ${summary.therapist} Indian psychologist)`,
    );
    console.log(`  Period:         ${summary.period.from} through ${summary.period.through}`);
    console.log(`  Demo clients:   ${summary.clients.toLocaleString('en-IN')}`);
    console.log(`  Sessions:       ${summary.sessions.toLocaleString('en-IN')}`);
    console.log(
      `  UAE Scribe:     ${summary.uae.sessions.toLocaleString('en-IN')} (${summary.uae.minDaily}–${summary.uae.maxDaily}/day)`,
    );
    console.log(
      `  India Mind:     ${summary.indiaPsychologists.sessions.toLocaleString('en-IN')} (${summary.indiaPsychologists.daily}/day)`,
    );
    console.log('  30 Sep status:  SCHEDULED; 1–29 Sep status: COMPLETED');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
