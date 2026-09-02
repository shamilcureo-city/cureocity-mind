import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const tokenHeaders = ["'Cache-Control': 'private, no-store'", "'Referrer-Policy': 'no-referrer'"];

describe('Sprint 5 independent review blockers', () => {
  it('requires a locked retained note for every signed note, intake, AVS and Rx snapshot', () => {
    const snapshots = read('lib/share-snapshots.ts');
    for (const builder of [
      'buildSignedNote',
      'buildSignedIntakeNote',
      'buildAfterVisitSummary',
      'buildRxPad',
    ]) {
      const start = snapshots.indexOf(`async function ${builder}`);
      const end = snapshots.indexOf('\nasync function ', start + 1);
      const source = snapshots.slice(start, end === -1 ? snapshots.length : end);
      expect(source).toContain('locked: true');
      expect(source).toMatch(/therapyNote\?\.locked|therapyNote\.locked/);
    }
  });

  it('sanitizes crisis provider failures without logging identities or exception text', () => {
    const outbox = read('lib/crisis-alert-outbox.ts');
    const marker = outbox.indexOf("errorCode: 'DELIVERY_EXCEPTION'");
    const catchBlock = outbox.slice(marker - 100, marker + 150);
    expect(catchBlock).not.toContain('psychologistId');
    expect(catchBlock).not.toContain('.message');
    expect(catchBlock).toContain('DELIVERY_EXCEPTION');
  });

  it('returns actual Mind share candidates in takeaway, homework, check-in, plan, signed-note order', () => {
    const route = read('app/api/v1/sessions/[id]/mind-share-options/route.ts');
    const labels = [
      "label: 'Session takeaway'",
      "label: 'Homework'",
      "label: 'Next-session check-in'",
      "label: 'Treatment-plan update'",
      "label: 'Full signed note'",
    ];
    expect(labels.map((label) => route.indexOf(label))).toEqual(
      [...labels.map((label) => route.indexOf(label))].sort((a, b) => a - b),
    );
  });

  it('keeps clinical outcomes out of audit metadata', () => {
    const checkin = read('app/api/v1/p/[token]/checkin/route.ts');
    const prepare = read('app/api/v1/clients/[id]/prepare/route.ts');
    const submittedAudit = checkin.slice(
      checkin.indexOf("action: 'PATIENT_CHECKIN_SUBMITTED'"),
      checkin.indexOf('// Safety net'),
    );
    const crisisAudit = checkin.slice(
      checkin.indexOf("action: 'CRISIS_FLAG_RAISED'"),
      checkin.indexOf('let alertAttemptId'),
    );
    expect(submittedAudit).not.toMatch(/instrumentKey:|score:|severity:|riskFlagged:/);
    expect(crisisAudit).not.toMatch(/instrumentKey:|score:|severity:|riskFlagged:/);
    expect(prepare.slice(prepare.indexOf("action: 'CLIENT_BRIEFING_VIEWED'"))).not.toMatch(
      /openCrisisCount:|homeworkCount:/,
    );
  });

  it('guards server pages and independently filters mixed prepare disclosures', () => {
    for (const page of ['app/app/sessions/[id]/page.tsx', 'app/app/today/page.tsx']) {
      const source = read(page);
      expect(source).toContain('getEffectiveCapabilities');
      expect(source).toContain('capabilities.has');
    }
    for (const capability of ['PATIENT_SHARING', 'THERAPY_WORKFLOWS']) {
      expect(read('app/app/sessions/[id]/page.tsx')).toContain(`capabilities.has('${capability}')`);
    }
    const prepare = read('app/api/v1/clients/[id]/prepare/route.ts');
    expect(prepare).toContain("requireCapability(req, 'CLINICAL_ANALYSIS')");
    expect(prepare).toContain("hasCapability('THERAPY_WORKFLOWS')");
    expect(prepare).toContain("hasCapability('MEASUREMENT_BASED_CARE')");
    expect(prepare).toContain("hasCapability('SAFETY_PLANNING')");
  });

  it('serializes portal open and revoke and commits open plus audit atomically', () => {
    const portal = read('app/p/[token]/page.tsx');
    const revoke = read('app/api/v1/shares/[id]/revoke/route.ts');
    expect(portal).toContain('lockShareFamily(tx, candidate)');
    expect(portal).toContain('writeAudit(');
    expect(portal).toContain('tx,');
    expect(portal).toContain('PortalUnavailableError');
    expect(revoke).toContain('lockShareFamily(tx, share)');
  });

  it('makes sharing state finalization, audits and provider idempotency explicit', () => {
    const share = read('app/api/v1/share/route.ts');
    const schema = read('../../prisma/schema.prisma');
    const resend = read('app/api/v1/shares/[id]/resend/route.ts');
    expect(share).toContain('providerIdempotencyKey');
    expect(share).toContain('requestPayloadHash');
    expect(share).toContain('ShareIdempotencyConflict');
    expect(share).toContain('dispatchLeaseExpiresAt');
    expect(share).toContain('PENDING_RECOVERY_CUTOFF_MS');
    expect(share).toContain("row.channel === 'PORTAL_LINK'");
    expect(share).toContain('specializedReplayAudits');
    expect(share).toContain('updateMany({');
    expect(share).toContain('dispatchStartedAt: null');
    expect(share).toContain('claim.count !== 1');
    expect(share).toContain('isPrismaUniqueConstraintError');
    expect(share).toContain('AMBIGUOUS_DELIVERY_NOT_RETRIED');
    expect(schema).toContain('@@unique([psychologistId, requestIdempotencyKey, channel])');
    expect(share).toContain('finalizeShareAttempt');
    expect(share).toContain('reserveShareCapacity');
    expect(resend.indexOf('shareChannels()')).toBeLessThan(resend.indexOf('patientShare.create'));
    expect(resend).toContain('providerIdempotencyKey');
    expect(resend).toContain('refreshRequestedAt: null');
    expect(resend).toContain("source.status === 'REVOKED'");
  });

  it('keeps resend descendants revoked across every revoke/finalize ordering', () => {
    const resend = read('app/api/v1/shares/[id]/resend/route.ts');
    const revoke = read('app/api/v1/shares/[id]/revoke/route.ts');
    const familyLock = read('lib/share-family-lock.ts');
    expect(familyLock).toContain('share-family:');
    expect(resend).toContain('lockShareFamily(tx, source)');
    expect(resend).toContain("where: { id: row.id, status: 'PENDING' }");
    expect(resend).toContain('finalized.count === 0');
    expect(revoke).toContain('lockShareFamily(tx, share)');
    expect(revoke).toContain('collectShareDescendantIds');
    expect(revoke).toContain("status: { in: ['PENDING', 'SENT', 'OPENED'] }");
  });

  it('locks claim issuance and takeaway eligibility in their write transactions', () => {
    const issue = read('app/api/v1/clients/[id]/claim-token/route.ts');
    const takeaway = read('app/api/v1/sessions/[id]/patient-takeaway/route.ts');
    expect(issue).toContain('FOR UPDATE OF c');
    expect(issue).toContain('clientClaimToken.updateMany');
    expect(issue.indexOf('clientClaimToken.updateMany')).toBeGreaterThan(
      issue.indexOf('FOR UPDATE OF c'),
    );
    expect(takeaway).toContain('lockActiveClientForSession');
    expect(takeaway.indexOf('session.findFirst')).toBeGreaterThan(
      takeaway.indexOf('lockActiveClientForSession'),
    );
  });

  it('keeps the legacy claim-token redeem response privacy markers', () => {
    const source = read('app/api/v1/claim-tokens/[token]/redeem/route.ts');
    for (const header of tokenHeaders) expect(source).toContain(header);
    // Share/resend/revoke/issuance are exercised as actual route behavior in
    // sprint5-final-route-privacy.spec.ts rather than asserted as source text.
  });

  it('validates therapy-script homework by snapshot assignment while HOMEWORK uses artefactId', () => {
    const route = read('app/api/v1/p/[token]/homework/route.ts');
    expect(route).toContain("currentShare.artefactType === 'HOMEWORK'");
    expect(route).toContain('currentSnapshot?.homeworkAssignmentId');
    expect(route).toContain('psychologistId: share.psychologistId');
  });

  it('accepts portal homework and check-ins only from active delivered shares', () => {
    for (const route of [
      'app/api/v1/p/[token]/homework/route.ts',
      'app/api/v1/p/[token]/checkin/route.ts',
    ]) {
      const source = read(route);
      expect(source).toContain("!['SENT', 'OPENED'].includes");
    }
  });

  it('queues fresh-link requests on the latest descendant under the family lock', () => {
    const route = read('app/api/v1/p/[token]/request-new-link/route.ts');
    expect(route).toContain(
      'lockShareFamily(tx, { id: rootId, shareBatchId: share.shareBatchId })',
    );
    expect(route).toContain('WITH RECURSIVE descendants');
    expect(route).toContain('ORDER BY "createdAt" DESC, "id" DESC');
    expect(route).toContain("status: { in: ['SENT', 'OPENED'] }");
    expect(route).toContain('expiresAt: { lte: now }');
  });

  it('preserves bounded care history, bounds every section, and validates the response contract', () => {
    const home = read('app/api/v1/p/home/route.ts');
    expect(home).toContain('SELECT DISTINCT ON ("artefactType", "artefactId")');
    expect(home).toContain('LIMIT 100');
    expect(home).toContain('.slice(0, 100)');
    expect(home).toContain('ClientCareHomeSchema.parse');
  });

  it('filters active care-home assignments before limiting and uses total newest order', () => {
    const home = read('app/api/v1/p/home/route.ts');
    expect(home).toContain("status: { in: ['PENDING', 'IN_PROGRESS'] }");
    expect(home).toContain("orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]");
  });

  it('uses total tie-break ordering for care-home assignments and sessions', () => {
    const home = read('app/api/v1/p/home/route.ts');
    expect(home).toContain("orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }]");
    expect(home).toContain("orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }]");
  });

  it('queries the true newest successful channel directly with a deterministic tie-break', () => {
    const route = read('app/api/v1/clients/[id]/shares/route.ts');
    expect(route).toContain("status: { in: ['SENT', 'OPENED'] }");
    expect(route).toContain("orderBy: [{ sentAt: 'desc' }, { id: 'desc' }]");
    expect(route).toContain('lastSuccessfulChannel');
    expect(read('components/app/ShareModal.tsx')).toContain('history.lastSuccessfulChannel');
  });

  it('dedupes Today share activity by batch and reads all homework response timestamps', () => {
    const today = read('app/app/today/page.tsx');
    expect(today).toContain('shareBatchId: true');
    expect(today).toContain('responseRecordedAt');
    expect(today).toContain('dedupeLatestShareActivity');
  });

  it('links explicit homework shares to the assignment source session even when omitted by caller', () => {
    const contracts = read('../../packages/contracts/src/share.ts');
    const snapshots = read('lib/share-snapshots.ts');
    expect(contracts).toContain('sessionId: CuidSchema.optional()');
    expect(snapshots).toContain('sourceSessionId: true');
    expect(snapshots).toContain('sessionId ?? assignment.sourceSessionId ?? null');
  });

  it('rejects archived clients in the assignment web route like continuity does', () => {
    const route = read('app/api/v1/assignments/route.ts');
    expect(route).toContain('deletedAt: true');
    expect(route).toContain('client.deletedAt !== null');
  });

  it('compares the normalized full assignment payload on idempotent replay', () => {
    const route = read('app/api/v1/assignments/route.ts');
    expect(route).toContain('normalizedAssignmentPayload');
    expect(route).toContain('assignmentPayloadMatches');
  });

  it('redacts historical provider details and never maps them outward', () => {
    const migration = read(
      '../../prisma/migrations/20260922000000_explicit_homework/migration.sql',
    );
    expect(migration).toContain('UPDATE "patient_shares" SET "errorDetail" = NULL');
    expect(read('lib/clinical-mappers.ts')).not.toContain('errorDetail: row.errorDetail');
    expect(read('../../packages/contracts/src/share.ts')).not.toMatch(/errorDetail:/);
  });

  it('fails closed for ambiguous role identities and practitioner provisioning', () => {
    const auth = read('lib/auth-server.ts');
    const session = read('app/api/v1/auth/session/route.ts');
    expect(auth).toContain('assertExclusiveFirebaseRole');
    expect(auth).toContain("role === 'AMBIGUOUS'");
    expect(auth).toContain('clientFirebaseUid: uid');
    expect(session).toContain('assertUidAvailableForPractitioner');
  });

  it('builds AVS medication lines only from the immutable signed Rx payload', () => {
    const snapshots = read('lib/share-snapshots.ts');
    const start = snapshots.indexOf('async function buildAfterVisitSummary');
    const end = snapshots.indexOf('\nasync function ', start + 1);
    const builder = snapshots.slice(start, end);
    expect(builder).toContain('rxPad: true');
    expect(builder).toContain('RxPadV1Schema.safeParse');
    expect(builder).not.toContain('medicationOrder.findMany');
  });

  it('resumes the exact existing share-rate reservation without a second create', () => {
    const share = read('app/api/v1/share/route.ts');
    const start = share.indexOf('async function reserveShareCapacity');
    const helper = share.slice(start);
    expect(helper).toContain('findUnique({');
    expect(helper).toContain('shareBatchId');
    expect(helper).toContain('existing.fanout === requestedFanout');
    expect(share).toContain('.update(`${auth.value.psychologistId}:${requestIdempotencyKey}`)');
  });

  it('gives every direct share caller a stable logical-action UUID', () => {
    for (const caller of [
      'components/app/ReviewAndSign.tsx',
      'components/app/ChronicCarePanel.tsx',
      'components/app/CareMeasurePanel.tsx',
      'components/app/WorkflowSection.tsx',
    ]) {
      const source = read(caller);
      expect(source).toContain('idempotencyKey');
      expect(source).toContain('randomUUID');
    }
  });

  it('queries Today active, future and business-time share activity authoritatively', () => {
    const today = read('app/app/today/page.tsx');
    expect(today).toContain('rawActiveSession');
    expect(today).toContain('rawNextFutureSession');
    expect(today).toContain(
      "orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]",
    );
  });

  it('bounds successful care-home shares at the database query', () => {
    const home = read('app/api/v1/p/home/route.ts');
    const sharesQuery = home.slice(
      home.indexOf('prisma.patientShare.findMany'),
      home.indexOf('prisma.exerciseAssignment.findMany'),
    );
    expect(sharesQuery).toContain('take:');
  });
});
