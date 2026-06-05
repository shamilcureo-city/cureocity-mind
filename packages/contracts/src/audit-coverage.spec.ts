import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuditActionSchema } from './audit';

/**
 * Audit coverage chaos test — Sprint 9 PR 4.
 *
 * The DPDP regulator may ask: "where is action X audited in your
 * codebase?" Reading every `audit.log` call by hand is intractable.
 * This test walks the service trees, extracts every literal
 * `action: 'X'` argument passed to an audit call, and asserts each
 * enum value in AuditActionSchema has at least one writer site.
 *
 * False positives are unlikely — there are no other reasons to write
 * `action: '<UPPER_SNAKE>'` in a NestJS service file. False negatives
 * (action computed dynamically rather than literal) are caught at
 * runtime by the audit DB constraint (Prisma enum); the static check
 * here is the early-warning layer.
 *
 * Excluded actions: NOTE_DRAFT_CREATED is written by the
 * note-generation worker which is mocked in tests; AUDIO_RETENTION_PURGED
 * is written by a cron in continuity-service. Both have writer sites
 * — they pass the scan. If a future action is added and is intentionally
 * not yet wired (e.g. lands in a later sprint), add it to the
 * KNOWN_UNWIRED_ACTIONS allowlist with a comment.
 */

// CJS-friendly resolution — __dirname is a node global in the compiled
// output. Vitest runs the source via SWC which keeps both __dirname and
// import.meta available, so this works under either module mode.
const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..');

const SCAN_ROOTS = [
  'services/patient-model-service/src',
  'services/scribe-service/src',
  'services/continuity-service/src',
  'services/affect-engine-service/src',
  'services/modality-workflow-service/src',
  'services/pdf-generator-service/src',
  // The web app's API routes are the authoritative writer sites for
  // any feature wired directly under apps/web/app/api (Sprint 3 onward
  // pivoted the monolith-mode app to write audits inline rather than
  // proxy through the NestJS service stubs).
  'apps/web/app/api',
];

/**
 * Actions known to land in a later sprint or to be reserved for a
 * subsequent code path. Empty for now — Sprint 9 is the closing
 * compliance sprint and the chaos test is the gate.
 */
const KNOWN_UNWIRED_ACTIONS = new Set<string>([
  // DSR_ACCESS_REQUESTED is the intent-recorded variant we don't
  // emit today — every access call goes directly to FULFILLED because
  // the export is synchronous. Reserved for an async export flow.
  'DSR_ACCESS_REQUESTED',
  // DSR_ERASURE_FULFILLED is written by the admin-side resolver,
  // which Sprint 10 wires through the admin queue UI. Today only the
  // REQUESTED path is reachable.
  'DSR_ERASURE_FULFILLED',
  // NOTIFICATION_DISPATCHED is reserved for the Sprint 10 fan-out
  // worker that pushes reminder notifications on a schedule. The
  // immediate-send path used in PR 4 doesn't emit it.
  'NOTIFICATION_DISPATCHED',
  // PSYCHOLOGIST_UPDATED is reserved for the PATCH /psychologists/me
  // flow that Sprint 10 adds alongside the admin profile UI. Today
  // we only emit PSYCHOLOGIST_REGISTERED on signup.
  'PSYCHOLOGIST_UPDATED',
  // CLIENT_SOFT_DELETED is wired into the schema (Client.deletedAt) but
  // there's no endpoint that calls it; the admin erasure-resolver
  // path in Sprint 10 will emit it.
  'CLIENT_SOFT_DELETED',
  // CONSENT_EXPIRED is reserved for the consent-expiry cron. Today
  // consents have nullable expiresAt and no enforcement job; Sprint 10
  // adds the cron alongside the retention sweeper.
  'CONSENT_EXPIRED',
  // SESSION_CANCELLED is reserved for the explicit cancel flow. Today
  // sessions are ended via SESSION_ENDED; cancellation is a Sprint 10
  // addition once the scheduling surface lands.
  'SESSION_CANCELLED',
  // WORKFLOW_COMPLETED — modality-workflow-service writes
  // WORKFLOW_PHASE_TRANSITIONED today; the terminal completion event
  // lands when Sprint 10 adds the discharge/transfer flows.
  'WORKFLOW_COMPLETED',
  // EXERCISE_SKIPPED — reserved for the patient skip path (PWA's
  // "skip for today" button). Sprint 8 PR 3 deferred skip; Sprint 10
  // adds it.
  'EXERCISE_SKIPPED',
  // JOURNAL_ENTRY_UPDATED — reserved for the journal-edit flow
  // (patient can edit/redact a past entry). Sprint 10 surface.
  'JOURNAL_ENTRY_UPDATED',
  // BOOKING_* + INTAKE_* writer sites currently live in
  // apps/web/_archive (the original therapist-directory + intake
  // flow was archived when the app pivoted to scribe-first onboarding
  // in Sprint 3). The enum stays so the audit shape is stable when
  // the surface is revived; until then, no live writer.
  'BOOKING_REQUESTED',
  'BOOKING_ACCEPTED',
  'BOOKING_DECLINED',
  'BOOKING_CANCELLED',
  'INTAKE_SUBMITTED',
  'INTAKE_REVIEWED',
  'INTAKE_MATCHED',
]);

function listSourceFiles(dir: string): string[] {
  const result: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      result.push(...listSourceFiles(full));
    } else if (
      stat.isFile() &&
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.spec.ts') &&
      !full.endsWith('.test.ts')
    ) {
      result.push(full);
    }
  }
  return result;
}

function extractWrittenActions(): Set<string> {
  const written = new Set<string>();
  // Two patterns matter:
  //   action: 'X'
  //   action: "X"
  // Both keys are captured by a single regex with alternation on quote.
  const re = /action:\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
  for (const root of SCAN_ROOTS) {
    const abs = join(WORKSPACE_ROOT, root);
    for (const file of listSourceFiles(abs)) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const action = m[1];
        if (action) written.add(action);
      }
    }
  }
  return written;
}

describe('Audit coverage (DPDP chaos test)', () => {
  it('every AuditActionSchema enum value has at least one writer site (or is known-unwired)', () => {
    const enumValues = new Set<string>(AuditActionSchema.options);
    const writtenActions = extractWrittenActions();

    const missing = [...enumValues].filter(
      (action) => !writtenActions.has(action) && !KNOWN_UNWIRED_ACTIONS.has(action),
    );

    if (missing.length > 0) {
      throw new Error(
        `These AuditAction values have NO writer site in services/. Either add a writer, or add to KNOWN_UNWIRED_ACTIONS with a comment explaining why:\n  ${missing.join('\n  ')}`,
      );
    }
    expect(missing).toEqual([]);
  });

  it('every writer site references a valid AuditActionSchema value (no typos)', () => {
    const enumValues = new Set<string>(AuditActionSchema.options);
    const writtenActions = extractWrittenActions();
    const stranger = [...writtenActions].filter((a) => !enumValues.has(a));
    if (stranger.length > 0) {
      throw new Error(
        `Found 'action: <value>' literals that are NOT in AuditActionSchema (likely typo):\n  ${stranger.join('\n  ')}`,
      );
    }
    expect(stranger).toEqual([]);
  });

  it('KNOWN_UNWIRED_ACTIONS does not list any action that IS in fact wired (dead allowlist entries)', () => {
    const writtenActions = extractWrittenActions();
    const stale = [...KNOWN_UNWIRED_ACTIONS].filter((a) => writtenActions.has(a));
    if (stale.length > 0) {
      throw new Error(
        `KNOWN_UNWIRED_ACTIONS lists actions that are now wired — remove them from the allowlist:\n  ${stale.join('\n  ')}`,
      );
    }
    expect(stale).toEqual([]);
  });
});
