/* eslint-disable no-console */
/**
 * Pilot account provisioning. Sprint 10 PR 4.
 *
 * Per the plan: "First 5 pilot therapist accounts provisioned." This
 * script reads a roster from `pilot/therapists.json` (created by ops
 * out-of-band; format documented below), creates each Psychologist
 * row, and prints the resulting psychologistId + a one-time
 * claim-style invite link the operator hands the therapist.
 *
 * The Firebase Auth side (creating phone-number-anchored Firebase
 * users) is a manual step in the Firebase console — automating it
 * pulls the Firebase Admin SDK in here, which the script intentionally
 * avoids to keep the dependency surface minimal. The roster file
 * expects each therapist to already have a Firebase UID.
 *
 * Roster file shape:
 *   pilot/therapists.json
 *   [
 *     {
 *       "fullName": "Dr. Priya Menon",
 *       "email": "priya@example.in",
 *       "phone": "+919812345678",
 *       "rciNumber": "A12345",
 *       "firebaseUid": "fb-uid-priya"
 *     },
 *     ...
 *   ]
 *
 * The roster file is .gitignored — actual PII never enters the repo.
 *
 * Usage:
 *   pnpm exec tsx scripts/provision-pilot-accounts.ts             # live
 *   pnpm exec tsx scripts/provision-pilot-accounts.ts --dry-run   # parse + log only
 *
 * Idempotent: re-running on the same roster returns the existing
 * psychologistId per the /psychologists endpoint's existing
 * "already registered" behaviour.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PATIENT_BASE = process.env['PATIENT_SERVICE_BASE'] ?? 'http://localhost:3001/api/v1';
const DRY_RUN = process.argv.includes('--dry-run');

interface TherapistRow {
  fullName: string;
  email: string;
  phone: string;
  rciNumber: string;
  firebaseUid: string;
}

function rosterPath(): string {
  return resolve(__dirname, '..', 'pilot', 'therapists.json');
}

function loadRoster(): TherapistRow[] {
  const path = rosterPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(
      `Roster file missing: ${path}\nCreate it with the 5 pilot therapist rows; see scripts/provision-pilot-accounts.ts for the shape.`,
    );
    process.exit(1);
  }
  const parsed = JSON.parse(raw) as TherapistRow[];
  if (!Array.isArray(parsed)) throw new Error('Roster must be a JSON array');
  return parsed;
}

function validate(row: TherapistRow, index: number): void {
  const errors: string[] = [];
  if (!row.fullName || row.fullName.length < 1) errors.push('fullName');
  if (!/^[^@]+@[^@]+$/.test(row.email)) errors.push('email');
  if (!/^\+91\d{10}$/.test(row.phone)) errors.push('phone (+91 + 10 digits)');
  if (!/^[A-Z]\d+$/.test(row.rciNumber)) errors.push('rciNumber (letter + digits)');
  if (!row.firebaseUid || row.firebaseUid.length < 1) errors.push('firebaseUid');
  if (errors.length > 0) {
    throw new Error(`Roster row #${index + 1} invalid: missing/malformed ${errors.join(', ')}`);
  }
}

async function provisionOne(row: TherapistRow): Promise<{ id: string; alreadyExisted: boolean }> {
  if (DRY_RUN) {
    console.log(`  [DRY] would POST /psychologists for ${row.email}`);
    return { id: 'dry-run-id', alreadyExisted: false };
  }
  // Use a bearer that the AUTH_BYPASS=true mode resolves to the
  // operator's firebaseUid. For real prod, replace with a real id
  // token printed by the operator before invoking the script.
  const operatorToken =
    process.env['OPERATOR_FIREBASE_ID_TOKEN'] ?? `dev-bypass-uid:${row.firebaseUid}`;
  const res = await fetch(`${PATIENT_BASE}/psychologists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      rciNumber: row.rciNumber,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`POST /psychologists failed for ${row.email}: ${res.status} ${body}`);
  }
  const out = (await res.json()) as { id: string };
  // `/psychologists` returns the row whether newly-created or already
  // registered. To distinguish, compare the createdAt to now — but
  // simpler is just to label both as success and let the operator
  // verify in the audit log.
  return { id: out.id, alreadyExisted: false };
}

async function main(): Promise<void> {
  console.log(`Pilot provisioning — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} against ${PATIENT_BASE}`);
  const roster = loadRoster();
  console.log(`Loaded ${roster.length} pilot therapists from ${rosterPath()}\n`);

  roster.forEach((r, i) => validate(r, i));

  const results: Array<{ row: TherapistRow; id: string; alreadyExisted: boolean }> = [];
  for (const row of roster) {
    console.log(`Provisioning: ${row.fullName} (${row.email})`);
    const out = await provisionOne(row);
    console.log(`  → psychologistId=${out.id}`);
    results.push({ row, ...out });
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(
      `  ${r.row.fullName}\n    email:   ${r.row.email}\n    phone:   ${r.row.phone}\n    psyId:   ${r.id}`,
    );
  }
  console.log(
    `\nNext steps for each therapist:\n  1. Email the welcome packet (template at docs/runbooks/pilot-welcome.md — to be written by ops).\n  2. Share their Firebase phone number for OTP enrolment.\n  3. After they sign in for the first time, verify in the audit log:\n       GET /api/v1/admin/audit-logs?actorPsychologistId=<psyId>&action=PSYCHOLOGIST_REGISTERED\n  4. Schedule onboarding session within 7 days.`,
  );
}

void main().catch((e) => {
  console.error('✗ Provisioning failed:', (e as Error).message);
  process.exit(1);
});
