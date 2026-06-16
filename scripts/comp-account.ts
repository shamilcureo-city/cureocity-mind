/**
 * One-shot account comp script (Sprint 56 ops).
 *
 * Gives a specific therapist a free Premium plan for ~1 year, bypassing
 * Razorpay. Idempotent: re-running just refreshes paidThroughAt and
 * audits the action again. Writes a PLAN_UPGRADED audit row tagged
 * { source: 'manual_comp', operator: '<arg>' } so the trail makes it
 * obvious in /app/admin/funnel + downstream reporting that this MRR is
 * comped, not a real charge.
 *
 * Run from your laptop against prod (NOT auto-run on Vercel):
 *
 *   DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' \
 *     pnpm exec tsx scripts/comp-account.ts \
 *       --phone='+917025840227' \
 *       --tier=PREMIUM \
 *       --months=12 \
 *       --operator='shamil@cureocitymind.com' \
 *       --reason='founder comp'
 *
 * Defaults match the request that prompted the first run (Premium, 12mo).
 * Add `--dry-run` to look up the row + print the planned change without
 * writing anything.
 */
import { PrismaClient, type BillingPlan } from '@prisma/client';

const TIER_TO_PLAN: Record<'PRO' | 'PREMIUM' | 'STARTER' | 'TRAINEE', BillingPlan> = {
  PRO: 'PRO_MONTHLY',
  PREMIUM: 'PREMIUM_MONTHLY',
  STARTER: 'STARTER_MONTHLY',
  TRAINEE: 'TRAINEE_MONTHLY',
};

interface Args {
  phone: string;
  tier: 'PRO' | 'PREMIUM' | 'STARTER' | 'TRAINEE';
  months: number;
  operator: string;
  reason: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const m = new Map<string, string>();
  for (const a of argv.slice(2)) {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    if (k) m.set(k, rest.join('='));
  }
  const tierRaw = (m.get('tier') ?? 'PREMIUM').toUpperCase();
  if (!['PRO', 'PREMIUM', 'STARTER', 'TRAINEE'].includes(tierRaw)) {
    throw new Error(`--tier must be one of PRO|PREMIUM|STARTER|TRAINEE (got "${tierRaw}")`);
  }
  return {
    phone: m.get('phone') ?? '+917025840227',
    tier: tierRaw as Args['tier'],
    months: Number(m.get('months') ?? 12),
    operator: m.get('operator') ?? 'unspecified',
    reason: m.get('reason') ?? 'manual comp',
    dryRun: m.has('dry-run'),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Args:', args);

  const prisma = new PrismaClient();
  const psy = await prisma.psychologist.findUnique({
    where: { phone: args.phone },
    select: { id: true, fullName: true, email: true, phone: true, deletedAt: true },
  });

  if (!psy) {
    console.error(`✗ No Psychologist found with phone="${args.phone}".`);
    console.error('  Check the exact format Firebase wrote — e.g. did it include +91? Run');
    console.error(
      `  SELECT id, "fullName", phone FROM psychologists WHERE phone LIKE '%${args.phone.slice(-10)}%';`,
    );
    process.exit(1);
  }
  if (psy.deletedAt !== null) {
    console.error(`✗ Psychologist ${psy.id} is soft-deleted (deletedAt=${psy.deletedAt.toISOString()}).`);
    process.exit(1);
  }

  const existingAccount = await prisma.billingAccount.findUnique({
    where: { psychologistId: psy.id },
    select: { plan: true, status: true, paidThroughAt: true },
  });

  const newPlan = TIER_TO_PLAN[args.tier];
  const newPaidThroughAt = new Date(Date.now() + args.months * 30 * 24 * 60 * 60 * 1000);

  console.log('\nFound:');
  console.log(`  id:    ${psy.id}`);
  console.log(`  name:  ${psy.fullName}`);
  console.log(`  email: ${psy.email}`);
  console.log(`  phone: ${psy.phone}`);
  console.log('\nBefore:');
  if (existingAccount) {
    console.log(`  plan: ${existingAccount.plan}`);
    console.log(`  status: ${existingAccount.status}`);
    console.log(`  paidThroughAt: ${existingAccount.paidThroughAt?.toISOString() ?? 'null'}`);
  } else {
    console.log('  (no BillingAccount row — will create)');
  }
  console.log('\nAfter:');
  console.log(`  plan: ${newPlan}`);
  console.log('  status: ACTIVE');
  console.log(`  paidThroughAt: ${newPaidThroughAt.toISOString()}`);

  if (args.dryRun) {
    console.log('\n--dry-run: no changes written.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    const account = await tx.billingAccount.upsert({
      where: { psychologistId: psy.id },
      create: {
        psychologistId: psy.id,
        plan: newPlan,
        status: 'ACTIVE',
        paidThroughAt: newPaidThroughAt,
      },
      update: {
        plan: newPlan,
        status: 'ACTIVE',
        paidThroughAt: newPaidThroughAt,
        pausedRemainingDays: null,
        canceledAt: null,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        actorPsychologistId: psy.id,
        action: 'PLAN_UPGRADED',
        targetType: 'BillingAccount',
        targetId: account.id,
        metadata: {
          source: 'manual_comp',
          operator: args.operator,
          reason: args.reason,
          tier: args.tier,
          plan: newPlan,
          monthsGranted: args.months,
          paidThroughAt: newPaidThroughAt.toISOString(),
          comp: true,
        },
      },
    });
  });

  console.log('\n✓ Comped.');
  console.log(
    `  Tip: this MRR row is tagged metadata.comp=true; the funnel dashboard's MRR card sums these together with real paid accounts. Subtract them in the SQL view if you want pure paid MRR.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
