/**
 * One-shot account relink script.
 *
 * Takes the Firebase identity bound to ONE Psychologist row (source,
 * found by phone) and moves it onto a DIFFERENT row (target, found by
 * firebaseUid). Used when an early sign-in created a fresh empty row
 * but the operator wants their login to land on a different,
 * pre-existing row (e.g. the seeded demo account, which carries
 * clients / sessions / notes you don't want to recreate).
 *
 * Run from your laptop against prod:
 *
 *   DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' \
 *     pnpm exec tsx scripts/relink-account.ts \
 *       --from-phone='+917025840227' \
 *       --to-firebase-uid='dev-firebase-uid-priya' \
 *       --operator='shamil@cureocitymind.com' \
 *       --reason='take over seeded demo account'
 *
 * --dry-run prints what would change without writing.
 *
 * What it does, in one transaction:
 *   1. Archive the source row: firebaseUid / phone / email rewritten
 *      to "archived:<id>" placeholders so the unique constraints free
 *      up, and deletedAt set to now so guards treat it as gone.
 *   2. Update the target row: firebaseUid / phone / email / fullName
 *      take over from the source so that the operator's existing
 *      login session resolves to the target row on the next request.
 *   3. Two PSYCHOLOGIST_UPDATED audit rows so the swap is reviewable
 *      end-to-end (`event: 'account-relink-source-archived'` on the
 *      source, `event: 'account-relink-target-promoted'` on the
 *      target, both tagged with operator + reason).
 *
 * Safe to re-run: the second run finds the source archived (phone no
 * longer matches +91…) and exits with an error — there's no idempotent
 * "already done" path because the relink is an identity swap, not a
 * setting toggle.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

interface Args {
  fromPhone: string;
  toFirebaseUid: string;
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
  const fromPhone = m.get('from-phone');
  const toFirebaseUid = m.get('to-firebase-uid');
  if (!fromPhone) throw new Error('--from-phone is required (E.164, e.g. +917025840227)');
  if (!toFirebaseUid) throw new Error('--to-firebase-uid is required');
  return {
    fromPhone,
    toFirebaseUid,
    operator: m.get('operator') ?? 'unspecified',
    reason: m.get('reason') ?? 'manual relink',
    dryRun: m.has('dry-run'),
  };
}

interface PsyRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  firebaseUid: string;
  deletedAt: Date | null;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Args:', args);

  const prisma = new PrismaClient();
  try {
    const source = (await prisma.psychologist.findUnique({
      where: { phone: args.fromPhone },
      select: { id: true, fullName: true, email: true, phone: true, firebaseUid: true, deletedAt: true },
    })) as PsyRow | null;
    const target = (await prisma.psychologist.findUnique({
      where: { firebaseUid: args.toFirebaseUid },
      select: { id: true, fullName: true, email: true, phone: true, firebaseUid: true, deletedAt: true },
    })) as PsyRow | null;

    if (!source) {
      console.error(`✗ No source Psychologist with phone="${args.fromPhone}".`);
      process.exit(1);
    }
    if (!target) {
      console.error(`✗ No target Psychologist with firebaseUid="${args.toFirebaseUid}".`);
      process.exit(1);
    }
    if (source.id === target.id) {
      console.error(`✗ Source and target are the same row (${source.id}) — nothing to do.`);
      process.exit(1);
    }
    if (source.deletedAt !== null) {
      console.error(`✗ Source ${source.id} is already soft-deleted at ${source.deletedAt.toISOString()}.`);
      process.exit(1);
    }
    if (target.deletedAt !== null) {
      console.error(`✗ Target ${target.id} is soft-deleted at ${target.deletedAt.toISOString()}.`);
      process.exit(1);
    }

    console.log(`\nSource (will be archived):  ${source.fullName} <${source.email}> ${source.phone} firebaseUid=${source.firebaseUid} (${source.id})`);
    console.log(`Target (will take over):    ${target.fullName} <${target.email}> ${target.phone} firebaseUid=${target.firebaseUid} (${target.id})`);
    console.log(`\nAfter:`);
    console.log(`  ${target.fullName} (${target.id}) — firebaseUid=${source.firebaseUid}, phone=${source.phone}, email=${source.email}`);
    console.log(`  Source row ${source.id} archived (firebaseUid/phone/email → archived:* placeholders, deletedAt set).`);

    if (args.dryRun) {
      console.log('\n--dry-run: no changes written.');
      process.exit(0);
    }

    await prisma.$transaction(async (tx) => {
      const archivedTag = `archived:${source.id}`;
      // 1. Archive source first so the unique columns free up.
      await tx.psychologist.update({
        where: { id: source.id },
        data: {
          firebaseUid: archivedTag,
          phone: archivedTag,
          email: `archived-${source.id}@cureocity.local`,
          deletedAt: new Date(),
        },
      });
      // 2. Promote target: take over source's identity.
      await tx.psychologist.update({
        where: { id: target.id },
        data: {
          firebaseUid: source.firebaseUid,
          phone: source.phone,
          email: source.email,
          fullName: source.fullName,
        },
      });
      // 3. Audit both sides of the swap.
      await writeAuditRow(tx, {
        actorPsychologistId: target.id,
        targetId: source.id,
        metadata: {
          event: 'account-relink-source-archived',
          operator: args.operator,
          reason: args.reason,
          archivedFirebaseUid: source.firebaseUid,
          archivedPhone: source.phone,
          archivedEmail: source.email,
          targetPsychologistId: target.id,
        },
      });
      await writeAuditRow(tx, {
        actorPsychologistId: target.id,
        targetId: target.id,
        metadata: {
          event: 'account-relink-target-promoted',
          operator: args.operator,
          reason: args.reason,
          previousFirebaseUid: target.firebaseUid,
          previousPhone: target.phone,
          previousEmail: target.email,
          adoptedFirebaseUid: source.firebaseUid,
          adoptedPhone: source.phone,
          adoptedEmail: source.email,
          sourcePsychologistId: source.id,
        },
      });
    });

    console.log(`\n✓ Relinked.`);
    console.log(`  Source ${source.id} archived.`);
    console.log(`  Target ${target.id} now reachable via firebaseUid=${source.firebaseUid} (phone=${source.phone}).`);
    console.log(`\nYour current browser session cookie is bound to firebaseUid=${source.firebaseUid}, so a hard refresh of /app should now land you on the target row.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function writeAuditRow(
  tx: Prisma.TransactionClient,
  args: { actorPsychologistId: string; targetId: string; metadata: Record<string, unknown> },
) {
  await tx.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      actorPsychologistId: args.actorPsychologistId,
      action: 'PSYCHOLOGIST_UPDATED',
      targetType: 'Psychologist',
      targetId: args.targetId,
      metadata: args.metadata as Prisma.InputJsonValue,
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
