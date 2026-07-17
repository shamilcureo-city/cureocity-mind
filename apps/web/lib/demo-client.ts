import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import {
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  InitialAssessmentBriefV1Schema,
  IntakeNoteV1Schema,
  PENDING_SECTION_CONFIRMATIONS,
  TherapyNoteV1Schema,
  TherapyScriptV1Schema,
  type ClinicalReportV1,
  type ClinicalSectionConfirmations,
  type ClinicalTreatmentPlan,
  type InitialAssessmentBriefV1,
  type IntakeNoteV1,
  type TherapyNoteV1,
  type TherapyScriptV1,
} from '@cureocity/contracts';
import { INSTRUMENTS, scoreInstrument } from '@cureocity/clinical';
import { prisma } from './prisma';
import { writeAudit } from './audit';
import { encryptForTenant } from './tenant-crypto';
import { buildProgressReport } from './progress-report';

/**
 * Sprint 48 — Demo showcase client.
 *
 * A single deterministic fabricator that lets a trialing therapist
 * one-click seed (or remove) a clearly-badged "Example" client whose
 * Journey arc is complete — intake + five treatment sessions, a
 * confirmed diagnosis + treatment plan, a PHQ-9 trend of 18 -> 14 ->
 * 9 -> 4 (reliable improvement + remission), a cached therapy script,
 * and a PORTAL_LINK Progress Report — so the Journey hub, the
 * reliable-change verdict, and the client-facing Progress Report are
 * visible in minute one without recording six real sessions.
 *
 * Design rules:
 *   - No LLM calls. Every fabricated body is deterministic and
 *     validated through the real Zod schemas at build time so drift
 *     fails loudly in CI.
 *   - No `[mock]` prefix anywhere. That tag is reserved for mock LLM
 *     output (and stripped by share-snapshots before sending) — demo
 *     content is real content from the fixture, not from a mock pass.
 *   - Idempotent on POST: a second call returns the existing demo
 *     client. Removal is a hard delete in FK-safe order inside one
 *     transaction (several session-referencing tables have no cascade).
 *   - The treatment episode stays OPEN so the Journey hub shows
 *     `DISCHARGE_READY`. A DISCHARGED episode would flip the hub to
 *     terminal and hide the "consider discharge" next-best-action.
 *   - PHQ-9 final score is 4 (not 5) because remission is <= 4 per
 *     packages/clinical/src/instruments/change-score.ts.
 */

const DEMO_NAME = 'Ananya Iyer (Example)';
const DEMO_PRIMARY_LANGUAGE = 'en';
const DEMO_SESSION_INTERVAL_DAYS = 7;
const PHQ9_SCORES: ReadonlyArray<number> = [18, 14, 9, 4];

export interface CreateDemoClientResult {
  clientId: string;
  /** True when a new client was created; false when an existing demo was returned. */
  created: boolean;
}

export interface RemoveDemoClientResult {
  /** True when a demo row was deleted. */
  removed: boolean;
  clientId: string | null;
}

/**
 * Find the (single) demo client for this therapist, if any.
 */
export async function findDemoClient(psychologistId: string): Promise<{ id: string } | null> {
  return prisma.client.findFirst({
    where: { psychologistId, isDemo: true, deletedAt: null },
    select: { id: true },
  });
}

/**
 * Seed the showcase arc. Idempotent — returns the existing demo row
 * unchanged on a second call.
 */
export async function createDemoClient(
  psychologistId: string,
  actorPsychologistId: string,
): Promise<CreateDemoClientResult> {
  const existing = await findDemoClient(psychologistId);
  if (existing) {
    return { clientId: existing.id, created: false };
  }

  // Backdate sessions weekly so they don't show up on the Today
  // screen. The latest session ends ~7 days before now; the intake is
  // ~5 weeks back.
  const now = new Date();
  const sessionDates: Date[] = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - DEMO_SESSION_INTERVAL_DAYS * (6 - i));
    d.setHours(10, 0, 0, 0);
    return d;
  });

  const intakeAt = sessionDates[0]!;
  const treatmentDates = sessionDates.slice(1);

  // ------------------------------------------------------------------
  // 1. Validate every fabricated body BEFORE opening the transaction
  //    so a schema drift fails loudly without leaving partial rows.
  // ------------------------------------------------------------------
  const intakeBody: IntakeNoteV1 = IntakeNoteV1Schema.parse(buildIntakeNote());
  const initialBrief: InitialAssessmentBriefV1 = InitialAssessmentBriefV1Schema.parse(
    buildInitialAssessmentBrief(),
  );
  const treatmentBody: TherapyNoteV1 = TherapyNoteV1Schema.parse(buildTreatmentNote());
  const clinicalReportBody: ClinicalReportV1 = ClinicalReportV1Schema.parse(buildClinicalReport());
  const planBody: ClinicalTreatmentPlan = ClinicalTreatmentPlanSchema.parse(buildTreatmentPlan());
  const scriptBody: TherapyScriptV1 = TherapyScriptV1Schema.parse(buildTherapyScript());

  // Score every PHQ-9 administration through the real scorer so the
  // responses / score / severity tuple is internally consistent and
  // the Progress Report builder sees the same trend the UI shows.
  const phq9 = INSTRUMENTS.PHQ9;
  const scoredPhq9 = PHQ9_SCORES.map((target) => {
    const responses = phq9ResponsesForScore(target);
    const result = scoreInstrument(phq9, responses, 'en');
    if (result.score !== target) {
      throw new Error(`[demo-client] PHQ-9 fixture for target ${target} scored ${result.score}`);
    }
    return { target, responses, result };
  });

  // PII is envelope-encrypted only. Encrypt outside the tx (may auto-provision
  // the tenant DEK). Empty phone round-trips to '' so ShareModal still greys
  // out WhatsApp + Email, leaving PORTAL_LINK as the demoable channel.
  const fullNameEncrypted = await encryptForTenant(psychologistId, DEMO_NAME);
  const contactPhoneEncrypted = await encryptForTenant(psychologistId, '');

  const clientId = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        psychologistId,
        fullNameEncrypted,
        contactPhoneEncrypted,
        contactEmailEncrypted: null,
        dateOfBirth: null,
        presentingConcerns:
          'Persistent low mood, loss of interest, sleep disruption, work performance worries.',
        preferredModality: 'CBT',
        preferredLanguage: DEMO_PRIMARY_LANGUAGE,
        spokenLanguages: ['en'],
        status: 'ACTIVE',
        isDemo: true,
      },
      select: { id: true },
    });

    // PROD5 — grant the three scribe consents so the therapist's dry run
    // starts without extra ticks (the demo client is a fixture, not a
    // person; /start now refuses sessions missing CROSS_BORDER_PROCESSING).
    await tx.consent.createMany({
      data: (['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'] as const).map(
        (scope) => ({
          clientId: client.id,
          psychologistId,
          scope,
          status: 'GRANTED' as const,
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON' as const,
          grantedAt: intakeAt,
          notes: 'Demo fixture — synthetic client, seeded at onboarding',
        }),
      ),
    });

    const episode = await tx.treatmentEpisode.create({
      data: {
        clientId: client.id,
        psychologistId,
        status: 'OPEN',
        openedAt: intakeAt,
      },
      select: { id: true },
    });

    // ---------- INTAKE SESSION ----------
    const intakeSession = await tx.session.create({
      data: {
        clientId: client.id,
        psychologistId,
        modality: 'INTAKE',
        kind: 'INTAKE',
        status: 'COMPLETED',
        scheduledAt: intakeAt,
        startedAt: intakeAt,
        endedAt: new Date(intakeAt.getTime() + 50 * 60 * 1000),
        language: DEMO_PRIMARY_LANGUAGE,
        spokenLanguages: ['en'],
      },
      select: { id: true },
    });

    const intakeDraft = await tx.noteDraft.create({
      data: {
        sessionId: intakeSession.id,
        status: 'COMPLETED',
        content: intakeBody as unknown as Prisma.InputJsonValue,
        riskSeverity: 'NONE',
      },
      select: { id: true },
    });

    await tx.therapyNote.create({
      data: {
        sessionId: intakeSession.id,
        draftId: intakeDraft.id,
        version: 'V1',
        content: intakeBody as unknown as Prisma.InputJsonValue,
        signedAt: new Date(intakeAt.getTime() + 60 * 60 * 1000),
        signedBy: psychologistId,
      },
    });

    // Initial Assessment Brief on the intake — Pass 3 output for INTAKE
    // sessions stores InitialAssessmentBriefV1 in `body`.
    await tx.clinicalReport.create({
      data: {
        sessionId: intakeSession.id,
        clientId: client.id,
        psychologistId,
        status: 'COMPLETED',
        body: initialBrief as unknown as Prisma.InputJsonValue,
        confirmations: PENDING_SECTION_CONFIRMATIONS as unknown as Prisma.InputJsonValue,
      },
    });

    // ---------- TREATMENT SESSIONS ----------
    // The diagnosis + plan are confirmed off the FIRST treatment session
    // (so the Clinical Brief tab on session 2 shows ACCEPTED rather than
    // PENDING). Subsequent treatment sessions reuse the same plan.
    const firstTreatmentDate = treatmentDates[0]!;
    let firstTreatmentSessionId: string | null = null;
    let firstTreatmentReportId: string | null = null;
    let firstDraftId: string | null = null;

    for (let i = 0; i < treatmentDates.length; i++) {
      const date = treatmentDates[i]!;
      const session = await tx.session.create({
        data: {
          clientId: client.id,
          psychologistId,
          modality: 'CBT',
          kind: 'TREATMENT',
          status: 'COMPLETED',
          scheduledAt: date,
          startedAt: date,
          endedAt: new Date(date.getTime() + 50 * 60 * 1000),
          language: DEMO_PRIMARY_LANGUAGE,
          spokenLanguages: ['en'],
        },
        select: { id: true },
      });

      const draft = await tx.noteDraft.create({
        data: {
          sessionId: session.id,
          status: 'COMPLETED',
          content: treatmentBody as unknown as Prisma.InputJsonValue,
          riskSeverity: 'NONE',
        },
        select: { id: true },
      });

      await tx.therapyNote.create({
        data: {
          sessionId: session.id,
          draftId: draft.id,
          version: 'V1',
          content: treatmentBody as unknown as Prisma.InputJsonValue,
          signedAt: new Date(date.getTime() + 60 * 60 * 1000),
          signedBy: psychologistId,
        },
      });

      // Clinical report on every treatment session, but only the first
      // one carries the ACCEPTED confirmations (that's where the
      // diagnosis + plan were locked in).
      const confirmations: ClinicalSectionConfirmations =
        i === 0
          ? buildAcceptedConfirmations(firstTreatmentDate, psychologistId)
          : PENDING_SECTION_CONFIRMATIONS;

      const report = await tx.clinicalReport.create({
        data: {
          sessionId: session.id,
          clientId: client.id,
          psychologistId,
          status: 'COMPLETED',
          body: clinicalReportBody as unknown as Prisma.InputJsonValue,
          confirmations: confirmations as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      if (i === 0) {
        firstTreatmentSessionId = session.id;
        firstTreatmentReportId = report.id;
        firstDraftId = draft.id;
      }
    }

    if (!firstTreatmentSessionId || !firstTreatmentReportId || !firstDraftId) {
      throw new Error('[demo-client] failed to capture first treatment session ids');
    }

    // Confirmed diagnosis — replicates from the ACCEPTED confirmation
    // on the first treatment report.
    const diagnosis = await tx.clientDiagnosis.create({
      data: {
        clientId: client.id,
        psychologistId,
        sessionId: firstTreatmentSessionId,
        clinicalReportId: firstTreatmentReportId,
        icd11Code: '6A70.1',
        icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
        confidence: 0.78,
        supportingEvidence: clinicalReportBody.diagnosisCandidates[0]!
          .supportingEvidence as unknown as Prisma.InputJsonValue,
        isPrimary: true,
        confirmedAt: new Date(firstTreatmentDate.getTime() + 30 * 60 * 1000),
        confirmedByPsychologistId: psychologistId,
      },
      select: { id: true },
    });

    // Confirmed treatment plan — first version.
    const plan = await tx.treatmentPlan.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: firstTreatmentSessionId,
        sourceClinicalReportId: firstTreatmentReportId,
        version: 1,
        body: planBody as unknown as Prisma.InputJsonValue,
        confirmedAt: new Date(firstTreatmentDate.getTime() + 30 * 60 * 1000),
        confirmedByPsychologistId: psychologistId,
      },
      select: { id: true },
    });

    // Per-goal progress (Sprint 20 Phase 3 follow-up). Goal 0 ACHIEVED,
    // goal 1 IN_PROGRESS — so "X of Y goals achieved" reads correctly
    // on the journey hub.
    await tx.treatmentGoalProgress.create({
      data: {
        treatmentPlanId: plan.id,
        goalIndex: 0,
        status: 'ACHIEVED',
        updatedByPsychologistId: psychologistId,
      },
    });
    await tx.treatmentGoalProgress.create({
      data: {
        treatmentPlanId: plan.id,
        goalIndex: 1,
        status: 'IN_PROGRESS',
        updatedByPsychologistId: psychologistId,
      },
    });

    // ---------- PHQ-9 trend ----------
    // Administered at intake, then at treatment session 2, session 4,
    // session 5 — final score 4 hits remission (<= 4) so the Journey
    // hub flips to DISCHARGE_READY.
    const phq9SessionByIndex = [
      intakeSession.id,
      treatmentDates[1] ? null : null, // filled below
    ];
    const phq9SessionIds: (string | null)[] = [
      intakeSession.id,
      null, // treatment session 2
      null, // treatment session 4
      null, // treatment session 5
    ];
    // Look up the treatment sessions we created above by date.
    const treatmentSessions = await tx.session.findMany({
      where: { clientId: client.id, kind: 'TREATMENT' },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, scheduledAt: true },
    });
    if (treatmentSessions.length >= 5) {
      phq9SessionIds[1] = treatmentSessions[1]!.id;
      phq9SessionIds[2] = treatmentSessions[3]!.id;
      phq9SessionIds[3] = treatmentSessions[4]!.id;
    }
    const phq9Dates = [
      intakeAt,
      treatmentDates[1] ?? treatmentDates[0]!,
      treatmentDates[3] ?? treatmentDates.at(-1)!,
      treatmentDates[4] ?? treatmentDates.at(-1)!,
    ];

    for (let i = 0; i < scoredPhq9.length; i++) {
      const { responses, result } = scoredPhq9[i]!;
      await tx.instrumentResponse.create({
        data: {
          clientId: client.id,
          psychologistId,
          sessionId: phq9SessionIds[i] ?? null,
          instrumentKey: 'PHQ9',
          language: 'en',
          responses: responses as unknown as Prisma.InputJsonValue,
          score: result.score,
          severity: result.severityKey,
          administeredAt: phq9Dates[i]!,
          administeredByPsychologistId: psychologistId,
          administrationMode: 'CLINICIAN',
        },
      });
    }
    void phq9SessionByIndex; // unused intermediate

    // ---------- Therapy script cache row ----------
    await tx.therapyScript.create({
      data: {
        clientId: client.id,
        psychologistId,
        therapyName: scriptBody.therapyName,
        language: scriptBody.language,
        // Deterministic cache key derived from the demo identity.
        cacheKey: deterministicScriptCacheKey(client.id, scriptBody.therapyName),
        body: scriptBody as unknown as Prisma.InputJsonValue,
        sourceTreatmentPlanId: plan.id,
        sourcePrimaryDiagnosisId: diagnosis.id,
      },
    });

    // ---------- Assessment items (running differential) ----------
    await tx.assessmentItem.createMany({
      data: [
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'ASSESSMENT_GAP',
          question: 'Confirm no episodes of elevated mood lasting >= 4 days.',
          rationale:
            'Rule out bipolar spectrum before committing to single-episode depressive disorder.',
          icd11Code: '6A70.1',
          status: 'CLOSED',
          sourceSessionId: intakeSession.id,
          addressedSessionId: firstTreatmentSessionId,
          resolutionNote: 'No history of hypomanic / manic episodes by detailed timeline.',
          closedAt: new Date(firstTreatmentDate.getTime() + 60 * 60 * 1000),
        },
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'INSTRUMENT',
          question: 'Re-administer PHQ-9 at session 8 to confirm sustained remission.',
          rationale:
            'Remission criteria met at latest administration (PHQ-9 = 4). Confirm durability over a further 2 weeks.',
          status: 'OPEN',
          sourceSessionId: treatmentSessions.at(-1)?.id ?? firstTreatmentSessionId,
        },
      ],
    });

    return client.id;
  });

  // ---------- Patient-share row carrying the Progress Report ----------
  // buildProgressReport reads from the DB, so it has to run AFTER the
  // transaction commits — the instrument rows must be visible.
  const reportBuild = await buildProgressReport({
    clientId,
    psychologistId,
    intro:
      'A quick recap of what we have been tracking together. Bring any questions to our next session.',
  });
  const shareToken = generateShareToken();
  await prisma.patientShare.create({
    data: {
      clientId,
      psychologistId,
      sessionId: null,
      artefactType: 'PROGRESS_REPORT',
      // We persist the report with the clientId as the artefactId — the
      // patient-share table doesn't have a dedicated ProgressReport
      // model; the snapshot IS the artefact.
      artefactId: clientId,
      channel: 'PORTAL_LINK',
      status: 'SENT',
      shareToken,
      language: DEMO_PRIMARY_LANGUAGE,
      snapshot: reportBuild.snapshot as unknown as Prisma.InputJsonValue,
      subject: reportBuild.subject,
      toContact: null,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: actorPsychologistId,
    action: 'DEMO_CLIENT_CREATED',
    targetType: 'Client',
    targetId: clientId,
    metadata: { isDemo: true },
  });

  return { clientId, created: true };
}

/**
 * Hard-delete the demo client in FK-safe order. Mirrors
 * `cleanupLegacySeedRows` in `prisma/seed.ts`. Several session-
 * referencing tables have no `onDelete: Cascade`, so the order
 * matters.
 */
export async function removeDemoClient(
  psychologistId: string,
  actorPsychologistId: string,
): Promise<RemoveDemoClientResult> {
  const existing = await findDemoClient(psychologistId);
  if (!existing) {
    return { removed: false, clientId: null };
  }
  const clientId = existing.id;

  await prisma.$transaction(async (tx) => {
    const sessionIds = (
      await tx.session.findMany({ where: { clientId }, select: { id: true } })
    ).map((s) => s.id);
    const therapyNoteIds = (
      await tx.therapyNote.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true },
      })
    ).map((n) => n.id);
    const treatmentPlanIds = (
      await tx.treatmentPlan.findMany({ where: { clientId }, select: { id: true } })
    ).map((p) => p.id);

    // Leaves first.
    await tx.treatmentGoalProgress.deleteMany({
      where: { treatmentPlanId: { in: treatmentPlanIds } },
    });
    await tx.noteEdit.deleteMany({ where: { therapyNoteId: { in: therapyNoteIds } } });

    await tx.therapyScript.deleteMany({ where: { clientId } });
    await tx.therapyNote.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.noteDraft.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.clientDiagnosis.deleteMany({ where: { clientId } });
    await tx.treatmentPlan.deleteMany({ where: { clientId } });
    await tx.clinicalReport.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.patientShare.deleteMany({ where: { clientId } });
    await tx.instrumentResponse.deleteMany({ where: { clientId } });
    await tx.safetyPlan.deleteMany({ where: { clientId } });
    await tx.preSessionBrief.deleteMany({ where: { clientId } });
    await tx.clientConceptualMap.deleteMany({ where: { clientId } });
    await tx.assessmentItem.deleteMany({ where: { clientId } });
    await tx.exerciseAssignment.deleteMany({ where: { clientId } });
    await tx.treatmentEpisode.deleteMany({ where: { clientId } });
    await tx.consent.deleteMany({ where: { clientId } });
    await tx.audioChunk.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.geminiCallLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.session.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });

    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId,
        action: 'DEMO_CLIENT_REMOVED',
        targetType: 'Client',
        targetId: clientId,
        metadata: { isDemo: true },
      },
      tx,
    );
  });

  return { removed: true, clientId };
}

// ============================================================================
// Fabrication helpers — deterministic content validated through the real
// schemas in createDemoClient(). Edit copy here, schema drift is caught
// at parse time so partial rows can't land.
// ============================================================================

function buildIntakeNote(): IntakeNoteV1 {
  return {
    version: 'V1',
    linkedEvidence: [],
    presentingConcerns:
      'Ananya, a 29-year-old software engineer in Bengaluru, presents with a four-month period of persistent low mood, anhedonia, and concentration difficulty that has begun to affect her work performance. She booked the session after a conversation with a close friend who had been through therapy.',
    historyOfPresentingIllness:
      'Onset four months ago following an extended performance-review cycle at work; precipitant subjectively absent but timing aligns with a relationship breakup. Course is gradual worsening rather than episodic. Severity: subjectively "8 out of 10 on the heaviest days." Triggers: Sunday evenings, performance reviews, family calls about marriage. Alleviators: time with one friend, running, weekend trips — but engagement with each has reduced over the last month.',
    pastPsychiatricHistory:
      'No prior diagnoses, no prior therapy, no psychiatric medication. No hospitalisations. Has not seen a psychiatrist.',
    familyHistory:
      'Mother treated for depression in her 40s with an SSRI for ~18 months, full recovery. No other psychiatric history known. Maternal grandmother had a stroke in her 60s.',
    socialHistory:
      'Currently single, lives alone in a rented flat in HSR Layout. Family of origin in Chennai, parents and one younger sister, calls weekly. Educated through B.Tech (NIT, 2018). Works full-time as a senior engineer at a mid-stage startup; manager is supportive. One close friend in Bengaluru, a small wider circle. No substance use beyond occasional social alcohol (1-2 drinks once a month). Sleep schedule has shifted later in the last two months.',
    mentalStatusExam:
      'Appearance: well-groomed, casually dressed. Behaviour: cooperative, eye contact briefly avoidant. Speech: normal rate, slightly soft volume. Mood: "low, flat." Affect: constricted, congruent. Thought process: linear, goal-directed. Thought content: negative self-evaluations ("I am letting everyone down"), no delusional content. Perception: no abnormal perceptions. Cognition: alert, oriented, attention mildly reduced. Insight: good. Judgement: good.',
    workingHypothesis:
      'Working hypothesis is a single episode of moderate depressive disorder (ICD-11 6A70.1), with possible adjustment context. Differential to clarify next session: bipolar spectrum (no obvious history but worth confirming), generalised anxiety co-occurrence (worry content present), persistent depressive disorder (timeline not yet long enough by definition).',
    immediatePlan:
      'Administer PHQ-9 and GAD-7 next session as a baseline. Provide psychoeducation on the moderate depression model. Confirm no active safety concerns; collaborate on a low-burden between-session goal (one 20-minute walk). Schedule weekly CBT sessions for the next 6-8 weeks pending confirmation of working hypothesis.',
    riskFlags: {
      severity: 'low',
      indicators: [],
      details:
        'No passive or active suicidal ideation reported. No intent, plan, means, or history. Subjective wish that "things were lighter" but explicitly distinct from a wish to be dead. Re-screen each session via PHQ-9 item 9.',
    },
  };
}

function buildInitialAssessmentBrief(): InitialAssessmentBriefV1 {
  return {
    version: 'V1',
    language: 'en',
    workingHypothesis:
      'A single episode of moderate depressive disorder (ICD-11 6A70.1), with the presenting picture more consistent with depression than with a primary anxiety disorder. Pending differential: bipolar spectrum (no evidence yet), persistent depressive disorder (duration threshold not met).',
    differential: [
      {
        icd11Code: '6A70.1',
        icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
        confidence: 0.7,
        supportingEvidence: [
          {
            quote:
              'I just feel flat most of the time, even on the weekends I used to look forward to.',
            speaker: 'client',
            startMs: 0,
          },
          {
            quote: "I can't seem to focus at work for more than ten minutes at a stretch.",
            speaker: 'client',
            startMs: 0,
          },
        ],
        gapsToFill: [
          'Confirm duration of low mood is between 2 weeks and 12 months for single-episode',
          'Confirm anhedonia or low mood present most of the day, nearly every day',
        ],
      },
      {
        icd11Code: '6B00',
        icd11Label: 'Generalised anxiety disorder',
        confidence: 0.25,
        supportingEvidence: [
          {
            quote: 'My head is constantly on the next thing I am dropping.',
            speaker: 'client',
            startMs: 0,
          },
        ],
        gapsToFill: [
          'Administer GAD-7 to quantify worry burden',
          'Confirm worry across multiple domains, not solely work-related',
        ],
      },
    ],
    assessmentGaps: [
      {
        question: 'Confirm no episodes of elevated mood lasting >= 4 days.',
        rationale: 'Rules out bipolar spectrum before committing to a treatment direction.',
        purpose: 'differentiate',
        targets: ['6A70.1', '6A60'],
      },
      {
        question: 'Establish baseline PHQ-9 and GAD-7 next session.',
        rationale: 'Anchors the measurement-based-care arc and reliable-change tracking.',
        purpose: 'context',
        targets: [],
      },
    ],
    formulation:
      'Ananya presents with a four-month period of moderate low mood, anhedonia, and concentration impairment, in the context of relationship change and work-pressure cycles. No prior episodes; family history of treated depression. No active safety concerns. Working hypothesis is a single moderate depressive episode; bipolar spectrum and GAD co-occurrence to be ruled out at the next session.',
    recommendedTherapies: [
      {
        name: 'Behavioural Activation',
        rationale:
          'First-line evidence for moderate depression, requires low cognitive load early in the episode, and matches her presenting withdrawal from previously valued activities.',
        evidenceSummary:
          'Meta-analyses (Mazzucchelli et al., 2009; Cuijpers et al., 2014) place BA in the first tier for adult depression with effect sizes comparable to CBT.',
        whenInPlan: 'Engagement & psychoeducation',
      },
    ],
    recommendedInstruments: ['PHQ9', 'GAD7'],
    crisisFlags: [],
  };
}

function buildTreatmentNote(): TherapyNoteV1 {
  return {
    version: 'V1',
    linkedEvidence: [],
    modality: 'CBT',
    subjective:
      'Client reports mood slightly improved this week. Completed two of the three planned walks. Worked through one thought-record around a difficult work conversation. Mentions the weekend felt "lighter than the last few."',
    objective:
      'Engaged, on-time. Affect slightly brighter than previous session. PHQ-9 administered (score recorded separately in the trend). No risk flags.',
    assessment:
      'Continuing response to behavioural activation + cognitive restructuring. Engagement strong. No new risk indicators. Plan continues per phase.',
    plan: 'Maintain BA schedule: three walks, one social contact, one valued activity. Add one thought-record per low-mood episode. Re-administer PHQ-9 in two sessions.',
    riskFlags: {
      severity: 'none',
      indicators: [],
    },
    phaseHints: [
      {
        phase: 'Active treatment',
        confidence: 0.85,
        rationale: 'Engagement and outcome trend both indicate the active phase is on track.',
      },
    ],
  };
}

function buildClinicalReport(): ClinicalReportV1 {
  return {
    version: 'V1',
    language: 'en',
    modality: 'CBT',
    diagnosisCandidates: [
      {
        icd11Code: '6A70.1',
        icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
        confidence: 0.78,
        supportingEvidence: [
          {
            quote: 'The weekends used to be the thing I looked forward to. Now they feel flat.',
            speaker: 'client',
            startMs: 0,
          },
          {
            quote: 'I can barely concentrate at work for ten minutes.',
            speaker: 'client',
            startMs: 0,
          },
        ],
        gapsToFill: [],
      },
    ],
    primaryDiagnosisIndex: 0,
    assessmentGaps: [
      {
        question: 'Continue tracking PHQ-9 every two sessions until remission is consolidated.',
        rationale: 'Sustained remission requires durability evidence over a 2-3 week window.',
        purpose: 'confirm',
        targets: ['6A70.1'],
      },
    ],
    formulation:
      'Moderate depressive episode in the context of work-stress and post-relationship adjustment, responding well to behavioural activation and cognitive restructuring. Engagement strong, outcome trend favourable, no current safety concerns.',
    treatmentPlan: buildTreatmentPlan(),
    planSuggestions: [],
    recommendedTherapies: [
      {
        name: 'Behavioural Activation',
        rationale: 'Already engaged; continue while the activity-mood link is strengthening.',
        evidenceSummary:
          'First-line evidence for moderate depression; effect sizes comparable to CBT.',
        whenInPlan: 'Active treatment',
      },
      {
        name: 'Cognitive Restructuring',
        rationale:
          'Useful for the residual negative self-evaluations once activation has stabilised.',
        evidenceSummary: 'Core CBT component, robust evidence across adult depression.',
        whenInPlan: 'Active treatment',
      },
    ],
    crisisFlags: [],
  };
}

function buildTreatmentPlan(): ClinicalTreatmentPlan {
  return {
    modality: 'CBT',
    phaseSequence: [
      'Engagement & psychoeducation',
      'Active treatment',
      'Consolidation & relapse-prevention',
    ],
    goals: [
      {
        description: 'Re-engage with three previously valued activities each week.',
        measure: 'Self-report log; activity count >= 3 for 4 consecutive weeks.',
      },
      {
        description:
          'Reduce PHQ-9 from moderate range to minimal range and sustain for two administrations.',
        measure: 'PHQ-9 score <= 4 at two consecutive administrations >= 2 weeks apart.',
      },
    ],
    expectedDurationSessions: 12,
  };
}

function buildTherapyScript(): TherapyScriptV1 {
  return {
    version: 'V1',
    language: 'en',
    therapyName: 'Behavioural Activation',
    openingScript:
      'Let us spend a moment on what felt different this past week. Where did you notice even a small lift, however brief?',
    mainExercise: {
      steps: [
        {
          id: 'review-activity-log',
          purpose: 'Reconnect activity to mood and notice the moments that already worked.',
          therapistSays:
            'You logged a few activities this week. Pick the one that surprised you most — either because it felt better than expected, or because it took less effort than you thought it would.',
          listenFor:
            'Specific examples of activities that produced even a small mood lift, and the conditions around them (time of day, company, beforehand state).',
          branches: [
            {
              ifClientSays: 'Nothing really helped.',
              thenDo:
                "Acknowledge gently, then ask: 'Was there a moment that was less heavy than another?' — we are looking for variability, not perfection.",
            },
            {
              ifClientSays: 'The morning walk helped most.',
              thenDo:
                "Build the next week's plan around that specific anchor — same time, same route, same friend if possible. Concreteness drives adherence.",
            },
          ],
        },
        {
          id: 'plan-next-week',
          purpose: 'Set 3 concrete activities for next week tied to the anchor we just found.',
          therapistSays:
            'Let us pick three small activities for next week. Concrete: a time, a place, a person if relevant. Easy enough you can do them on a heavier day.',
          listenFor:
            'Whether the activities are tied to specific anchors. Watch for over-ambition (a sign of catching up rather than engagement).',
          branches: [],
        },
      ],
    },
    adaptationCues: [
      'If the client gets stuck on negative self-talk, pause activation and run one thought-record.',
      'If the client reports flat affect throughout, check sleep and PHQ-9 trend before adding more activities.',
    ],
    closingScript:
      'Before you go: pick one of the three activities we just planned that you are most confident about, and tell me when you will do it.',
    homework: {
      description:
        'Complete three planned activities this week; note your mood (0-10) just before and just after each one.',
      deliveryNotes:
        'Use the WhatsApp link the therapist shares; one row per activity; reply with the mood numbers — no narrative needed.',
    },
    riskWatchpoints: [
      'Any new passive suicidal ideation, even fleeting',
      'Sleep collapse (< 4 hours) for two nights in a row',
    ],
    estimatedDurationMin: 45,
  };
}

function buildAcceptedConfirmations(
  confirmedAt: Date,
  psychologistId: string,
): ClinicalSectionConfirmations {
  const iso = new Date(confirmedAt.getTime() + 30 * 60 * 1000).toISOString();
  const accepted = {
    status: 'ACCEPTED' as const,
    confirmedAt: iso,
    confirmedByPsychologistId: psychologistId,
    reason: null,
    edits: null,
  };
  return {
    diagnosis: accepted,
    gaps: accepted,
    formulation: accepted,
    plan: accepted,
    therapies: accepted,
    crisis: accepted,
  };
}

/**
 * Build a PHQ-9 item map that sums to the target score with item 9
 * (suicidality) held at 0, so the demo doesn't fire spurious crisis
 * audits. Distribution is the smallest set of "moderate-day" answers
 * that hit the target; severity bands are derived by the real scorer
 * downstream.
 */
function phq9ResponsesForScore(target: number): Record<string, number> {
  if (target < 0 || target > 24) {
    throw new Error(`[demo-client] PHQ-9 target out of range: ${target}`);
  }
  // Items 1..8 each accept 0..3; item 9 stays 0.
  const responses: Record<string, number> = {};
  let remaining = target;
  for (let i = 1; i <= 8; i++) {
    const v = Math.min(3, remaining);
    responses[`phq9_${i}`] = v;
    remaining -= v;
  }
  responses.phq9_9 = 0;
  if (remaining !== 0) {
    throw new Error(`[demo-client] PHQ-9 target ${target} could not be allocated`);
  }
  return responses;
}

function deterministicScriptCacheKey(clientId: string, therapyName: string): string {
  // 64-char hex SHA-256 of the demo identity tuple; matches the
  // (clientId, cacheKey) uniqueness invariant on TherapyScript.
  return createHash('sha256').update(`${clientId}:demo:${therapyName}`).digest('hex');
}

function generateShareToken(): string {
  // 22-char base64url (~128 bits of entropy) — matches Sprint 15 shape.
  return randomBytes(16).toString('base64url').slice(0, 22);
}
