/**
 * One-shot account comp script (Sprint 56 ops).
 *
 * Thin CLI wrapper around apps/web/lib/comp.ts → compAccount(). Use
 * POST /api/v1/admin/comp (or the form at /console/comp) as the
 * primary path; this script exists for emergencies where the deployed
 * app isn't reachable.
 *
 * Run from your laptop against prod:
 *
 *   DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' \
 *     pnpm exec tsx scripts/comp-account.ts \
 *       --phone='+917025840227' \
 *       --tier=PREMIUM \
 *       --months=12 \
 *       --operator='shamil@cureocitymind.com' \
 *       --reason='founder comp'
 *
 * --dry-run prints the lookup + planned change without writing.
 */
import { compAccount, CompError, isCompTier, type CompTier } from '../apps/web/lib/comp';

interface Args {
  phone: string;
  tier: CompTier;
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
  if (!isCompTier(tierRaw)) {
    throw new Error(`--tier must be one of PRO|PREMIUM|STARTER|TRAINEE (got "${tierRaw}")`);
  }
  return {
    phone: m.get('phone') ?? '+917025840227',
    tier: tierRaw,
    months: Number(m.get('months') ?? 12),
    operator: m.get('operator') ?? 'unspecified',
    reason: m.get('reason') ?? 'manual comp',
    dryRun: m.has('dry-run'),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Args:', args);

  if (args.dryRun) {
    // Dry-run path: only look up + print, no writes. Avoids calling
    // compAccount() which always writes when it succeeds.
    const { prisma } = await import('../apps/web/lib/prisma');
    const psy = await prisma.psychologist.findUnique({
      where: { phone: args.phone },
      select: { id: true, fullName: true, email: true, phone: true, deletedAt: true },
    });
    if (!psy) {
      console.error(`✗ No Psychologist with phone="${args.phone}".`);
      process.exit(1);
    }
    const existing = await prisma.billingAccount.findUnique({
      where: { psychologistId: psy.id },
      select: { plan: true, status: true, paidThroughAt: true },
    });
    console.log(`\nFound: ${psy.fullName} (${psy.id})`);
    console.log(
      `Before: ${existing ? `${existing.plan} ${existing.status} paid through ${existing.paidThroughAt?.toISOString() ?? 'null'}` : '(no account)'}`,
    );
    console.log(`After:  ${args.tier} ACTIVE paid through now + ${args.months} months`);
    console.log('\n--dry-run: no changes written.');
    process.exit(0);
  }

  try {
    const r = await compAccount(args);
    console.log(`\n✓ Comped ${r.fullName} (${r.psychologistId})`);
    console.log(
      `  Before: ${r.before ? `${r.before.plan} · ${r.before.status} · ${r.before.paidThroughAt ?? 'null'}` : '(no account — created)'}`,
    );
    console.log(`  After:  ${r.after.plan} · ${r.after.status} · ${r.after.paidThroughAt}`);
  } catch (e) {
    if (e instanceof CompError) {
      console.error(`✗ ${e.code}: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
